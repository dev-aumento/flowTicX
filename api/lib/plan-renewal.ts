import * as cookie from "cookie";
import type { UserDoc } from "@db/mongo/types";
import { findUserById } from "../queries/users";
import { hasMongoConfigured } from "../queries/mongo";
import { getSessionCookieOptions } from "./cookies";
import * as mock from "./mock-store";
import { signPlanRenewalToken, verifyPlanRenewalToken } from "./session";

export const PLAN_RENEWAL_COOKIE = "aaso_plan_renew";
const MAX_AGE_SEC = 2 * 60 * 60;

export async function appendPlanRenewalCookie(
  resHeaders: Headers,
  reqHeaders: Headers,
  userId: number,
) {
  const token = await signPlanRenewalToken(userId);
  const opts = getSessionCookieOptions(reqHeaders);
  resHeaders.append(
    "set-cookie",
    cookie.serialize(PLAN_RENEWAL_COOKIE, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: MAX_AGE_SEC,
      expires: new Date(Date.now() + MAX_AGE_SEC * 1000),
    }),
  );
}

export function clearPlanRenewalCookie(reqHeaders: Headers, resHeaders: Headers) {
  const opts = getSessionCookieOptions(reqHeaders);
  resHeaders.append(
    "set-cookie",
    cookie.serialize(PLAN_RENEWAL_COOKIE, "", {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
      expires: new Date(0),
    }),
  );
}

export async function userFromPlanRenewalCookie(headers: Headers): Promise<UserDoc | null> {
  const token = cookie.parse(headers.get("cookie") || "")[PLAN_RENEWAL_COOKIE];
  if (!token) return null;
  const claim = await verifyPlanRenewalToken(token);
  if (!claim) return null;
  const user = hasMongoConfigured()
    ? await findUserById(claim.userId)
    : mock.mockFindUserById(claim.userId);
  if (!user || String(user.status ?? "").toLowerCase() !== "active") return null;
  return user;
}
