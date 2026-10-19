import type { CookieOptions } from "hono/utils/cookie";

/** Local dev hosts, including the Android emulator and a phone on the same Wi-Fi. */
export function isLocalDevHost(hostHeader: string): boolean {
  const hostname = hostHeader.split(":")[0]?.trim().toLowerCase().replace(/^\[|\]$/g, "") ?? "";
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "10.0.2.2"
  ) {
    return true;
  }
  return /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(
    hostname,
  );
}

function isLocalRequest(headers: Headers): boolean {
  return isLocalDevHost(headers.get("host") || "");
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalRequest(headers);

  return {
    httpOnly: true,
    path: "/",
    sameSite: localhost ? "Lax" : "None",
    secure: !localhost,
  };
}
