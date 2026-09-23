import "dotenv/config";
import { isMongoUriConfigured } from "../api/lib/env";
import { bootstrapMongo } from "../api/lib/migrate-indexes";
import { getMongoDb } from "../api/queries/mongo";
import { Collections } from "./mongo/collections";

function printSetupHelp() {
  console.error(`
MongoDB is not configured yet.

Your .env is missing the Atlas cluster hostname.

How to find it:
  1. Open MongoDB Atlas → Database
  2. On cluster "Aumento-Track", click Connect
  3. Choose "Drivers" → copy the connection string
  4. The host looks like: cluster0.xxxxx.mongodb.net

Then add to .env:
  MONGODB_CLUSTER_HOST=cluster0.xxxxx.mongodb.net
  MONGODB_USER=track_crm_db_user
  MONGODB_PASSWORD=your_password
  MONGODB_DB_NAME=tracker_app

Also ensure Network Access allows your IP (Atlas → Network Access).

Then run:  npm run db:init
`);
}

async function main() {
  if (!isMongoUriConfigured()) {
    printSetupHelp();
    process.exit(1);
  }

  console.log("Connecting to MongoDB Atlas...");
  const db = await getMongoDb();
  await db.command({ ping: 1 });
  console.log(`Connected to database: ${db.databaseName}`);

  console.log("Creating collections and indexes...");
  await bootstrapMongo();

  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).sort();
  console.log(`\nCollections in "${db.databaseName}" (${names.length}):`);
  for (const name of names) {
    const marker = Object.values(Collections).includes(name as (typeof Collections)[keyof typeof Collections])
      ? " ✓"
      : "";
    console.log(`  - ${name}${marker}`);
  }

  console.log("\nDone! Refresh Data Explorer in Atlas to see the tracker_app database.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nInit failed:", err.message);
  if (err.message?.includes("authentication") || err.message?.includes("bad auth")) {
    console.error(`
Authentication failed — check Atlas Database Access:
  1. Atlas → Security → Database Access
  2. Confirm user "${process.env.MONGODB_USER ?? "track_crm_db_user"}" exists
  3. Edit user → Edit Password → set a new password
  4. Update MONGODB_PASSWORD in .env
  5. Run: npm run db:init
`);
  }
  if (err.message?.includes("ENOTFOUND") || err.message?.includes("querySrv")) {
    console.error("Check MONGODB_STANDARD_HOSTS or MONGODB_CLUSTER_HOST in .env");
  }
  process.exit(1);
});
