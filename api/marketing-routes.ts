import type { Hono } from "hono";
import { authenticateRequest, clearSessionCookie } from "./lib/auth";
import {
  initialsFromName,
  isAllowedMarketingOrigin,
  publicAvatarUrl,
  requestPublicOrigin,
  safeReturnUrl,
} from "./lib/marketing-session";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const hits = new Map<string, number[]>();

export type MarketingProfile = {
  name: string | null;
  avatar: string | null;
};

function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

function rateLimited(ip: string, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((at) => now - at >= WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

function applyPublicHeaders(headers: Headers, origin: string | null) {
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Origin");
  if (isAllowedMarketingOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin!);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
}

async function defaultLookup(headers: Headers, url: string): Promise<MarketingProfile | null> {
  try {
    const user = await authenticateRequest(headers, url);
    if (String(user.status ?? "").toLowerCase() !== "active") return null;
    return { name: user.name ?? null, avatar: user.avatar ?? null };
  } catch {
    return null;
  }
}

function appendClears(response: Response, requestHeaders: Headers) {
  const jar = new Headers();
  clearSessionCookie(requestHeaders, jar);
  for (const value of jar.getSetCookie()) {
    response.headers.append("set-cookie", value);
  }
  return response;
}

export function mountMarketingSession(
  app: Hono,
  lookup: (headers: Headers, url: string) => Promise<MarketingProfile | null> = defaultLookup,
) {
  app.get("/api/me", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = new Headers();
    applyPublicHeaders(headers, origin);
    headers.set("content-type", "application/json; charset=utf-8");

    if (rateLimited(clientIp(c.req.raw.headers))) {
      return new Response(JSON.stringify({ signedIn: false }), { status: 429, headers });
    }

    const profile = await lookup(c.req.raw.headers, c.req.url);
    if (!profile) {
      const response = new Response(JSON.stringify({ signedIn: false }), { status: 401, headers });
      return appendClears(response, c.req.raw.headers);
    }

    const appOrigin = requestPublicOrigin(c.req.raw.headers, c.req.url);
    const name = profile.name?.trim() || "Member";
    const body = {
      signedIn: true,
      name,
      initials: initialsFromName(name),
      avatar: publicAvatarUrl(profile.avatar, appOrigin),
      workspaceUrl: appOrigin ? `${appOrigin}/` : "https://app.aaso.tech/",
    };
    return new Response(JSON.stringify(body), { status: 200, headers });
  });

  app.get("/logout", (c) => {
    const requested = c.req.query("return");
    if (requested?.trim()) {
      const target = safeReturnUrl(requested);
      if (!target) {
        const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" });
        const response = new Response(JSON.stringify({ error: "Invalid return URL" }), {
          status: 400,
          headers,
        });
        return appendClears(response, c.req.raw.headers);
      }
      const response = new Response(null, {
        status: 302,
        headers: { Location: target, "Cache-Control": "private, no-store" },
      });
      return appendClears(response, c.req.raw.headers);
    }

    const response = new Response(null, {
      status: 302,
      headers: { Location: "https://aaso.tech", "Cache-Control": "private, no-store" },
    });
    return appendClears(response, c.req.raw.headers);
  });
}

export function resetMarketingRateLimit() {
  hits.clear();
}
