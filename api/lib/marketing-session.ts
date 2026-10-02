import * as cookie from "cookie";
import { Session } from "@contracts/constants";

/** Readable by aaso.tech. Display data only — never a session or token. */
export const HINT_COOKIE = "aaso_user";

const HINT_MAX_BYTES = 1000;

export type HintProfile = {
  name: string | null;
  avatar: string | null;
};

export type HintPayload = {
  v: 1;
  name: string;
  initials: string;
  avatar: string | null;
  exp: number;
};

const DEFAULT_ORIGINS = [
  "https://aaso.tech",
  "https://www.aaso.tech",
  "https://app.aaso.tech",
];

export function requestHostname(headers: Headers) {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (forwarded || headers.get("host") || "").trim().toLowerCase();
  return host.split(":")[0] ?? "";
}

export function requestPublicOrigin(headers: Headers, url?: string) {
  const hostHeader = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host")?.trim();
  if (hostHeader) {
    const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const hostname = hostHeader.split(":")[0]?.toLowerCase() ?? "";
    const proto =
      forwardedProto ||
      (hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https");
    return `${proto}://${hostHeader}`.replace(/\/$/, "");
  }
  try {
    return new URL(url || "http://localhost").origin;
  } catch {
    return "";
  }
}

/** Parent domain only on aaso.tech hosts. Localhost stays host-only. */
export function hintCookieDomain(hostname: string) {
  const configured = process.env.AASO_HINT_COOKIE_DOMAIN?.trim();
  if (configured) return configured.startsWith(".") ? configured : `.${configured}`;
  const host = hostname.toLowerCase();
  if (host === "aaso.tech" || host.endsWith(".aaso.tech")) return ".aaso.tech";
  return undefined;
}

export function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function publicAvatarUrl(avatar: string | null | undefined, origin: string) {
  const value = avatar?.trim() ?? "";
  if (!value || value.startsWith("data:")) return null;
  if (value.startsWith("https://")) return value.length > 500 ? null : value;
  if (value.startsWith("/") && origin.startsWith("https://")) {
    const absolute = `${origin}${value}`;
    return absolute.length > 500 ? null : absolute;
  }
  return null;
}

export function buildHintPayload(
  profile: HintProfile,
  origin: string,
  now = Date.now(),
): HintPayload {
  const name = (profile.name?.trim() || "Member").slice(0, 80);
  return {
    v: 1,
    name,
    initials: initialsFromName(name),
    avatar: publicAvatarUrl(profile.avatar, origin),
    exp: Math.floor((now + Session.maxAgeMs) / 1000),
  };
}

function hintCookieOptions(headers: Headers) {
  const hostname = requestHostname(headers);
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const domain = hintCookieDomain(hostname);
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: !local,
    httpOnly: false as const,
    ...(domain ? { domain } : {}),
  };
}

export function serializeHintCookie(headers: Headers, profile: HintProfile, origin: string) {
  const maxAge = Math.floor(Session.maxAgeMs / 1000);
  const base = hintCookieOptions(headers);
  let payload = buildHintPayload(profile, origin);
  let value = JSON.stringify(payload);
  let encoded = cookie.serialize(HINT_COOKIE, value, {
    ...base,
    maxAge,
    expires: new Date(Date.now() + Session.maxAgeMs),
  });
  if (encoded.length > HINT_MAX_BYTES && payload.avatar) {
    payload = { ...payload, avatar: null };
    value = JSON.stringify(payload);
    encoded = cookie.serialize(HINT_COOKIE, value, {
      ...base,
      maxAge,
      expires: new Date(Date.now() + Session.maxAgeMs),
    });
  }
  return encoded;
}

/** Same Domain and Path as serializeHintCookie, or the browser keeps the old cookie. */
export function clearHintCookie(headers: Headers) {
  return cookie.serialize(HINT_COOKIE, "", {
    ...hintCookieOptions(headers),
    maxAge: 0,
    expires: new Date(0),
  });
}

export function marketingOrigins() {
  const extra = (process.env.MARKETING_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

export function isAllowedMarketingOrigin(origin: string | null | undefined) {
  if (!origin) return false;
  return marketingOrigins().has(origin);
}

/** Full URL on an allowed host, or null when it must not be followed. */
export function safeReturnUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (local) {
    if (process.env.NODE_ENV === "production") return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  }
  if (url.protocol !== "https:") return null;
  if (!marketingOrigins().has(url.origin)) return null;
  return url.toString();
}
