import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { Session } from "@contracts/constants";
import {
  buildHintPayload,
  clearHintCookie,
  safeReturnUrl,
  serializeHintCookie,
} from "./marketing-session";
import { mountMarketingSession, resetMarketingRateLimit } from "../marketing-routes";

const appHost = new Headers({ host: "app.aaso.tech" });

describe("marketing hint cookie", () => {
  it("stores display fields only, scoped to .aaso.tech", () => {
    const encoded = serializeHintCookie(
      appHost,
      { name: "Pritesh Patel", avatar: "https://app.aaso.tech/avatars/u123.jpg" },
      "https://app.aaso.tech",
    );
    expect(encoded).toMatch(/Domain=\.aaso\.tech/i);
    expect(encoded).toMatch(/Secure/i);
    expect(encoded).toMatch(/SameSite=Lax/i);
    expect(encoded).toMatch(/Path=\//);
    expect(encoded).not.toMatch(/HttpOnly/i);
    expect(encoded).toContain(`Max-Age=${Math.floor(Session.maxAgeMs / 1000)}`);

    const raw = encoded.slice("aaso_user=".length).split(";")[0] ?? "";
    const payload = JSON.parse(decodeURIComponent(raw));
    expect(payload).toMatchObject({
      v: 1,
      name: "Pritesh Patel",
      initials: "PP",
      avatar: "https://app.aaso.tech/avatars/u123.jpg",
    });
    expect(payload.email).toBeUndefined();
    expect(payload.exp).toEqual(expect.any(Number));
  });

  it("drops data-url avatars and clears with the same domain", () => {
    const payload = buildHintPayload(
      { name: "A", avatar: "data:image/png;base64,aaaa" },
      "https://app.aaso.tech",
    );
    expect(payload.avatar).toBeNull();

    const cleared = clearHintCookie(appHost);
    expect(cleared).toMatch(/Domain=\.aaso\.tech/i);
    expect(cleared).toMatch(/Path=\//);
    expect(cleared).not.toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it("refuses a return URL on another host", () => {
    expect(safeReturnUrl("https://aaso.tech")).toBe("https://aaso.tech/");
    expect(safeReturnUrl("https://example.com")).toBeNull();
    expect(safeReturnUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("GET /api/me and /logout", () => {
  beforeEach(() => {
    resetMarketingRateLimit();
  });

  it("returns JSON 401 with no redirect when signed out", async () => {
    const app = new Hono();
    mountMarketingSession(app, async () => null);
    const response = await app.request("https://app.aaso.tech/api/me", {
      headers: { origin: "https://aaso.tech", host: "app.aaso.tech" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ signedIn: false });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://aaso.tech");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns the display fields for a live session", async () => {
    const app = new Hono();
    mountMarketingSession(app, async () => ({
      name: "Pritesh Patel",
      avatar: "https://app.aaso.tech/avatars/u123.jpg",
    }));
    const response = await app.request("https://app.aaso.tech/api/me", {
      headers: { origin: "https://www.aaso.tech", host: "app.aaso.tech" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      signedIn: true,
      name: "Pritesh Patel",
      initials: "PP",
      avatar: "https://app.aaso.tech/avatars/u123.jpg",
      workspaceUrl: "https://app.aaso.tech/",
    });
  });

  it("clears both cookies and returns to an allowed host", async () => {
    const app = new Hono();
    mountMarketingSession(app, async () => null);
    const response = await app.request("https://app.aaso.tech/logout?return=https://aaso.tech", {
      headers: { host: "app.aaso.tech" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://aaso.tech/");
    const cookies = response.headers.getSetCookie();
    const hint = cookies.find((item) => item.startsWith("aaso_user="));
    const session = cookies.find((item) => item.startsWith("app_sid="));
    expect(hint).toMatch(/Domain=\.aaso\.tech/i);
    expect(hint).not.toMatch(/HttpOnly/i);
    expect(session).toMatch(/HttpOnly/i);
    expect(session).not.toMatch(/Domain=/i);
  });

  it("does not follow a return URL on another site", async () => {
    const app = new Hono();
    mountMarketingSession(app, async () => null);
    const response = await app.request("https://app.aaso.tech/logout?return=https://example.com", {
      headers: { host: "app.aaso.tech" },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "Invalid return URL" });
  });
});
