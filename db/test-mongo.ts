import "dotenv/config";
import { isMongoUriConfigured } from "../api/lib/env";
import { getMongoDb } from "../api/queries/mongo";

async function main() {
  if (!isMongoUriConfigured()) {
    console.error("MongoDB not configured. Set MONGODB_CLUSTER_HOST in .env, then run: npm run db:init");
    process.exit(1);
  }
  const db = await getMongoDb();
  await db.command({ ping: 1 });
  const collections = await db.listCollections().toArray();
  console.log("MongoDB connection OK");
  console.log("Database:", db.databaseName);
  console.log("Collections:", collections.length);
  process.exit(0);
}

main().catch((err) => {
  console.error("MongoDB connection failed:", err.message);
  process.exit(1);
});
