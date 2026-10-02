import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { getMongoDb, hasMongoConfigured } from "../queries/mongo";

const COLLECTION = "password_resets";
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

type ResetRecord = {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  lastSentAt: Date;
};

const memory = new Map<string, ResetRecord>();

function newId() {
  return randomBytes(24).toString("hex");
}

function hashCode(email: string, code: string) {
  return createHmac("sha256", env.appSecret || "aaso-password-reset")
    .update(`${email}:${code}`)
    .digest("hex");
}

function codesMatch(email: string, code: string, codeHash: string) {
  const next = Buffer.from(hashCode(email, code), "hex");
  const prev = Buffer.from(codeHash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

async function persist(record: ResetRecord) {
  memory.set(record.email, record);
  if (!hasMongoConfigured()) return;
  const db = await getMongoDb();
  await db.collection(COLLECTION).updateOne({ email: record.email }, { $set: record }, { upsert: true });
}

async function load(email: string): Promise<ResetRecord | null> {
  const cached = memory.get(email);
  if (cached) return cached;
  if (!hasMongoConfigured()) return null;
  const db = await getMongoDb();
  const stored = await db.collection<ResetRecord>(COLLECTION).findOne({ email });
  if (!stored) return null;
  memory.set(stored.email, stored);
  return stored;
}

async function remove(email: string) {
  memory.delete(email);
  if (!hasMongoConfigured()) return;
  const db = await getMongoDb();
  await db.collection(COLLECTION).deleteOne({ email });
}

export async function issuePasswordResetCode(email: string, code: string) {
  const existing = await load(email);
  if (existing && asDate(existing.expiresAt).getTime() > Date.now()) {
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - asDate(existing.lastSentAt).getTime());
    if (waitMs > 0) {
      return { retryAfterSeconds: Math.ceil(waitMs / 1000) };
    }
  }

  const record: ResetRecord = {
    id: newId(),
    email,
    codeHash: hashCode(email, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    attempts: 0,
    lastSentAt: new Date(),
  };
  await persist(record);
  return { retryAfterSeconds: 0 };
}

async function readActiveReset(email: string, code: string) {
  const record = await load(email);
  if (!record) return { error: "missing" as const, record: null };
  if (asDate(record.expiresAt).getTime() < Date.now()) {
    await remove(email);
    return { error: "expired" as const, record: null };
  }
  if (!codesMatch(email, code.trim(), record.codeHash)) {
    record.attempts += 1;
    if (record.attempts >= MAX_ATTEMPTS) {
      await remove(email);
      return { error: "locked" as const, record: null };
    }
    await persist(record);
    return { error: "invalid" as const, record: null };
  }
  return { error: null, record };
}

/** Confirms the code without using it up, so the password step can still submit it. */
export async function checkPasswordResetCode(email: string, code: string) {
  const result = await readActiveReset(email, code);
  return { error: result.error };
}

export async function verifyPasswordResetCode(email: string, code: string) {
  const result = await readActiveReset(email, code);
  return { error: result.error };
}

export async function clearPasswordResetCode(email: string) {
  await remove(email);
}
