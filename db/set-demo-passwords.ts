import "dotenv/config";
import { hashPassword } from "../api/lib/password";
import { ensureSchema } from "../api/lib/migrate";
import { getCollection } from "../api/queries/mongo";
import { Collections } from "./mongo/collections";
import type { UserDoc } from "./mongo/types";

async function main() {
  await ensureSchema();
  const passwordHash = await hashPassword("password123");
  const col = await getCollection<UserDoc>(Collections.users);
  const result = await col.updateMany(
    { $or: [{ passwordHash: null }, { passwordHash: { $exists: false } }] },
    { $set: { passwordHash, updatedAt: new Date() } },
  );
  console.log(`Updated ${result.modifiedCount} user(s) with demo password.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
