import { MongoClient, type Collection, type Db, type Document, type Filter } from "mongodb";
import { Collections, type CollectionName } from "@db/mongo/collections";
import { env, isDatabaseEnabled } from "../lib/env";

let client: MongoClient | null = null;
let db: Db | null = null;
let connectPromise: Promise<Db> | null = null;

function isStaleTopologyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /electionId\/setVersion mismatch/i.test(message) ||
    /primary marked stale/i.test(message) ||
    /Legacy topology/i.test(message) ||
    /TopologyDescriptionChanged/i.test(message) ||
    /MongoServerSelectionError/i.test(message) ||
    /not primary/i.test(message) ||
    /not master/i.test(message)
  );
}

async function closeMongoClient() {
  const current = client;
  client = null;
  db = null;
  connectPromise = null;
  if (!current) return;
  try {
    await current.close(true);
  } catch (error) {
    console.warn("[mongo] Failed to close stale client:", error);
  }
}

async function createMongoDb(): Promise<Db> {
  if (!isDatabaseEnabled()) {
    throw new Error(
      "Database is disabled. Set USE_DATABASE=true and MongoDB connection values in .env to reconnect.",
    );
  }

  const uri = env.mongoUri;
  const singleHost = uri.startsWith("mongodb://") && !uri.includes(",");
  const nextClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    minPoolSize: 2,
    maxPoolSize: 20,
    family: 4,
    // A tunneled standalone host must not try to discover other replica members.
    directConnection: singleHost,
  });

  try {
    await nextClient.connect();
    // Force a topology refresh against the current primary.
    await nextClient.db("admin").command({ ping: 1 });
    client = nextClient;
    db = nextClient.db(env.mongoDbName);
    return db;
  } catch (error) {
    try {
      await nextClient.close(true);
    } catch {
      // ignore close errors while failing connect
    }
    throw error;
  }
}

export async function getMongoDb(): Promise<Db> {
  if (db) return db;

  if (!connectPromise) {
    connectPromise = createMongoDb().catch((error) => {
      connectPromise = null;
      client = null;
      db = null;
      throw error;
    });
  }

  return connectPromise;
}

/** Drop the cached client so the next call reconnects cleanly. */
export async function resetMongoConnection() {
  await closeMongoClient();
}

/**
 * Run a Mongo operation and reconnect once if the driver has a stale
 * replica-set topology (common after Atlas storage upgrades / elections).
 */
export async function withMongoRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isStaleTopologyError(error)) throw error;
    console.warn("[mongo] Stale topology detected — reconnecting…", error);
    await resetMongoConnection();
    return operation();
  }
}

export async function getCollection<T extends Document>(
  name: CollectionName,
): Promise<Collection<T>> {
  const database = await getMongoDb();
  return database.collection<T>(name);
}

export async function nextId(name: CollectionName): Promise<number> {
  return withMongoRetry(async () => {
    const counters = await getCollection<{ _id: string; seq: number }>(Collections.counters);
    const result = await counters.findOneAndUpdate(
      { _id: name },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    return result?.seq ?? 1;
  });
}

const ORG_NUMBERED_COLLECTIONS = new Set<CollectionName>([Collections.projects, Collections.tasks]);

type OrgNumberedDoc = {
  id: number;
  organizationId?: number | null;
  number?: number | null;
  createdAt?: Date;
};

function orgNumberKey(name: CollectionName, organizationId: number) {
  return `${name}:org:${organizationId}`;
}

/** Give existing projects or tasks in one workspace the numbers 1, 2, 3… by creation time. */
async function ensureOrgNumberCounter(name: CollectionName, organizationId: number) {
  const col = await getCollection<OrgNumberedDoc>(name);
  const missing = await col
    .find({
      organizationId,
      $or: [{ number: { $exists: false } }, { number: null }],
    })
    .sort({ createdAt: 1, id: 1 })
    .toArray();
  const highest = await col
    .find({ organizationId, number: { $type: "number" } })
    .sort({ number: -1 })
    .limit(1)
    .toArray();
  let seq = typeof highest[0]?.number === "number" ? highest[0].number : 0;
  for (const doc of missing) {
    seq += 1;
    await col.updateOne({ id: doc.id, organizationId }, { $set: { number: seq } });
  }
  if (seq > 0) {
    const counters = await getCollection<{ _id: string; seq: number }>(Collections.counters);
    await counters.updateOne({ _id: orgNumberKey(name, organizationId) }, { $max: { seq } }, { upsert: true });
  }
}

export async function ensureOrgDisplayNumbers(name: CollectionName, organizationId: number) {
  if (!ORG_NUMBERED_COLLECTIONS.has(name)) return;
  await withMongoRetry(() => ensureOrgNumberCounter(name, organizationId));
}

export async function nextOrgNumber(name: CollectionName, organizationId: number) {
  return withMongoRetry(async () => {
    await ensureOrgNumberCounter(name, organizationId);
    const counters = await getCollection<{ _id: string; seq: number }>(Collections.counters);
    const result = await counters.findOneAndUpdate(
      { _id: orgNumberKey(name, organizationId) },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    return result?.seq ?? 1;
  });
}

export async function findById<T extends { id: number }>(
  name: CollectionName,
  id: number,
): Promise<T | null> {
  return withMongoRetry(async () => {
    const col = await getCollection<T>(name);
    return col.findOne({ id } as Filter<T>);
  });
}

export async function insertDoc<T extends { id: number }>(
  name: CollectionName,
  doc: Omit<T, "id">,
): Promise<T> {
  return withMongoRetry(async () => {
    const id = await nextId(name);
    const organizationId = (doc as { organizationId?: number | null }).organizationId;
    const number =
      ORG_NUMBERED_COLLECTIONS.has(name) && typeof organizationId === "number"
        ? await nextOrgNumber(name, organizationId)
        : undefined;
    const full = { ...doc, id, ...(number != null ? { number } : {}) } as T;
    const col = await getCollection<T>(name);
    await col.insertOne(full as Document & T);
    return full;
  });
}

export async function updateById<T extends { id: number }>(
  name: CollectionName,
  id: number,
  patch: Partial<T>,
): Promise<T | null> {
  return withMongoRetry(async () => {
    const col = await getCollection<T>(name);
    await col.updateOne({ id } as Filter<T>, { $set: patch });
    return findById<T>(name, id);
  });
}

export async function countDocs(
  name: CollectionName,
  filter: Document = {},
): Promise<number> {
  return withMongoRetry(async () => {
    const col = await getCollection(name);
    return col.countDocuments(filter);
  });
}

export function hasMongoConfigured() {
  return isDatabaseEnabled();
}
