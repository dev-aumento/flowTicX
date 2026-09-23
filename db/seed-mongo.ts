import "dotenv/config";
import { ensureSchema } from "../api/lib/migrate";

async function seed() {
  console.log("Initializing database schema (collections + indexes only)...");
  console.log("Note: db:seed does NOT delete data or create users.");
  console.log("  Empty all data + admin:  npm run db:reset");
  console.log("  Create/update admin only: npm run db:ensure-admin");
  console.log("");
  await ensureSchema();
  console.log("Done.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
