import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { getMongoDb, hasMongoConfigured } from "../queries/mongo";

const COLLECTION = "login_challenges";
const CODE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

export type ClientLoginMembership = {
  userId: number;
  organizationId: number;
};

type TicketRecord = {
  id: string;
  kind: "ticket";
  email: string;
  memberships: ClientLoginMembership[];
  expiresAt: Date;
};

type CodeRecord = {
  id: string;
  kind: "code";
  email: string;
  userId: number;
  organizationId: number;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  lastSentAt: Date;
};

type ChallengeRecord = TicketRecord | CodeRecord;

const memory = new Map<string, ChallengeRecord>();

function newId() {
  return randomBytes(24).toString("hex");
}

function hashCode(challengeId: string, code: string) {
  return createHmac("sha256", env.appSecret || "aaso-client-login")
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

function codesMatch(challengeId: string, code: string, codeHash: string) {
  const next = Buffer.from(hashCode(challengeId, code), "hex");
  const prev = Buffer.from(codeHash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

async function persist(record: ChallengeRecord) {
  memory.set(record.id, record);
  if (!hasMongoConfigured()) return;
  const db = await getMongoDb();
  await db.collection(COLLECTION).updateOne({ id: record.id }, { $set: record }, { upsert: true });
}

async function load(id: string): Promise<ChallengeRecord | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  if (!hasMongoConfigured()) return null;
  const db = await getMongoDb();
  const stored = await db.collection<ChallengeRecord>(COLLECTION).findOne({ id });
  if (!stored) return null;
  memory.set(stored.id, stored);
  return stored;
}

async function remove(id: string) {
  memory.delete(id);
  if (!hasMongoConfigured()) return;
  const db = await getMongoDb();
  await db.collection(COLLECTION).deleteOne({ id });
}

async function removeCodesForEmail(email: string) {
  for (const [id, record] of memory) {
    if (record.kind === "code" && record.email === email) memory.delete(id);
  }
  if (!hasMongoConfigured()) return;
  const db = await getMongoDb();
  await db.collection(COLLECTION).deleteMany({ kind: "code", email });
}

export function createLoginCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function createClientLoginTicket(email: string, memberships: ClientLoginMembership[]) {
  const record: TicketRecord = {
    id: newId(),
    kind: "ticket",
    email,
    memberships,
    expiresAt: new Date(Date.now() + TICKET_TTL_MS),
  };
  await persist(record);
  return record.id;
}

export async function readClientLoginTicket(ticket: string) {
  const record = await load(ticket);
  if (!record || record.kind !== "ticket") return null;
  if (record.expiresAt.getTime() < Date.now()) {
    await remove(ticket);
    return null;
  }
  return record;
}

export async function issueClientLoginCode(input: {
  email: string;
  userId: number;
  organizationId: number;
  code: string;
}) {
  await removeCodesForEmail(input.email);
  const id = newId();
  const record: CodeRecord = {
    id,
    kind: "code",
    email: input.email,
    userId: input.userId,
    organizationId: input.organizationId,
    codeHash: hashCode(id, input.code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    attempts: 0,
    lastSentAt: new Date(),
  };
  await persist(record);
  return record;
}

export async function resendClientLoginCode(challengeId: string, code: string) {
  const record = await load(challengeId);
  if (!record || record.kind !== "code") return { error: "missing" as const };
  if (record.expiresAt.getTime() < Date.now()) {
    await remove(challengeId);
    return { error: "expired" as const };
  }
  const waitMs = RESEND_COOLDOWN_MS - (Date.now() - record.lastSentAt.getTime());
  if (waitMs > 0) return { error: "cooldown" as const, retryAfterSeconds: Math.ceil(waitMs / 1000) };
  record.codeHash = hashCode(challengeId, code);
  record.attempts = 0;
  record.lastSentAt = new Date();
  record.expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await persist(record);
  return { error: null, record };
}

export async function consumeClientLoginCode(challengeId: string, code: string) {
  const record = await load(challengeId);
  if (!record || record.kind !== "code") return { error: "missing" as const };
  if (record.expiresAt.getTime() < Date.now()) {
    await remove(challengeId);
    return { error: "expired" as const };
  }
  record.attempts += 1;
  if (!codesMatch(challengeId, code.trim(), record.codeHash)) {
    if (record.attempts >= MAX_ATTEMPTS) {
      await remove(challengeId);
      return { error: "locked" as const };
    }
    await persist(record);
    return { error: "invalid" as const };
  }
  await remove(challengeId);
  return { error: null, record };
}
