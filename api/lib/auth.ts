import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import type { SafeUser } from "../queries/users";
import { findUserById, omitPasswordHash } from "../queries/users";
import { getSessionCookieOptions } from "./cookies";
import { signSessionToken, verifySessionToken } from "./session";
import { hasMongoConfigured } from "../queries/mongo";
import * as mock from "./mock-store";

const AUTH_USER_CACHE_TTL_MS = 20_000;
const authUserCache = new Map<number, { user: SafeUser; expiresAt: number }>();

export function invalidateAuthUserCache(userId?: number) {
  if (typeof userId === "number") {
    authUserCache.delete(userId);
    return;
  }
  authUserCache.clear();
}

/** Cookie, Authorization Bearer, or access_token query (for EventSource). */
export function getSessionTokenFromHeaders(headers: Headers, url?: string): string | null {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const fromCookie = cookies[Session.cookieName];
  if (fromCookie) return fromCookie;

  const auth = headers.get("authorization") || headers.get("Authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer?.[1]) return bearer[1].trim();

  if (url) {
    try {
      const parsed = new URL(url);
      const fromQuery = parsed.searchParams.get("access_token");
      if (fromQuery) return fromQuery.trim();
    } catch {
      // ignore invalid URL
    }
  }

  return null;
}

export async function authenticateRequest(headers: Headers, url?: string) {
  const token = getSessionTokenFromHeaders(headers, url);
  if (!token) {
    throw Errors.forbidden("Invalid authentication token.");
  }

  const claim = await verifySessionToken(token);
  if (!claim) {
    throw Errors.forbidden("Invalid authentication token.");
  }

  const cached = authUserCache.get(claim.userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const user = hasMongoConfigured()
    ? await findUserById(claim.userId)
    : mock.mockFindUserById(claim.userId);
  if (!user) {
    throw Errors.forbidden("User not found. Please sign in again.");
  }

  if (user.status !== "active") {
    throw Errors.forbidden("Account is not active.");
  }

  const safeUser = omitPasswordHash(user);
  authUserCache.set(claim.userId, {
    user: safeUser,
    expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
  });
  return safeUser;
}

export async function createSessionForUser(
  userId: number,
  reqHeaders: Headers,
  resHeaders: Headers,
): Promise<string> {
  invalidateAuthUserCache(userId);
  const token = await signSessionToken({ userId });
  appendSessionCookie(resHeaders, reqHeaders, token);
  return token;
}

export function appendSessionCookie(
  resHeaders: Headers,
  reqHeaders: Headers,
  token: string,
) {
  const opts = getSessionCookieOptions(reqHeaders);
  const maxAgeSec = Math.floor(Session.maxAgeMs / 1000);
  const expires = new Date(Date.now() + Session.maxAgeMs);
  resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: maxAgeSec,
      expires,
    }),
  );
}

export function clearSessionCookie(reqHeaders: Headers, resHeaders: Headers) {
  const opts = getSessionCookieOptions(reqHeaders);
  resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, "", {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
      expires: new Date(0),
    }),
  );
}
