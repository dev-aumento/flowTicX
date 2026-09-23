import "dotenv/config";
import { ensureSchema } from "../api/lib/migrate";
import { backfillEmployeesFromUsers } from "../api/queries/employees";

async function main() {
  console.log("Syncing employees collection from users...");
  await ensureSchema();
  const result = await backfillEmployeesFromUsers();
  console.log(
    `Done. ${result.created} created, ${result.updated} updated (${result.total} employee users in total).`,
  );
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
