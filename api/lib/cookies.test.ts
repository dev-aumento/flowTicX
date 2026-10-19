import { describe, expect, it } from "vitest";
import { getSessionCookieOptions, isLocalDevHost } from "./cookies";

describe("local session cookies", () => {
  it("keeps the emulator and LAN hosts on a non-secure cookie", () => {
    expect(isLocalDevHost("10.0.2.2:3000")).toBe(true);
    expect(isLocalDevHost("192.168.1.8:3000")).toBe(true);
    expect(isLocalDevHost("app.aaso.tech")).toBe(false);

    const emulator = getSessionCookieOptions(new Headers({ host: "10.0.2.2:3000" }));
    expect(emulator.secure).toBe(false);
    expect(emulator.sameSite).toBe("Lax");

    const live = getSessionCookieOptions(new Headers({ host: "app.aaso.tech" }));
    expect(live.secure).toBe(true);
    expect(live.sameSite).toBe("None");
  });
});
