import * as jose from "jose";
import { env } from "./env";

const JWT_ALG = "HS256";

export type SessionPayload = {
  userId: number;
};

function jwtSecret() {
  return new TextEncoder().encode(env.appSecret);
}

export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  return new jose.SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(jwtSecret());
}

/** Short-lived proof that this person just authenticated while the workspace plan was blocked. */
export async function signPlanRenewalToken(userId: number): Promise<string> {
  return new jose.SignJWT({ userId, purpose: "plan-renew" })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(jwtSecret());
}

export async function verifyPlanRenewalToken(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jose.jwtVerify(token, jwtSecret(), { algorithms: [JWT_ALG] });
    if (payload.purpose !== "plan-renew") return null;
    const userId = payload.userId;
    if (typeof userId !== "number") return null;
    return { userId };
  } catch {
    return null;
  }
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jose.jwtVerify(token, jwtSecret(), {
      algorithms: [JWT_ALG],
    });
    if (payload.purpose != null) return null;
    const userId = payload.userId;
    if (typeof userId !== "number") {
      return null;
    }
    return { userId };
  } catch {
    return null;
  }
}
