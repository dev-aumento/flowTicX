import "dotenv/config";
import { ensureSchema } from "../api/lib/migrate";
import { getCollection } from "../api/queries/mongo";
import { Collections } from "./mongo/collections";
import { ensureDefaultAdmin } from "./ensure-admin";

const CLEAR_ORDER: (typeof Collections)[keyof typeof Collections][] = [
  Collections.taskTagRelations,
  Collections.taskAttachments,
  Collections.taskActivity,
  Collections.subtasks,
  Collections.taskParticipants,
  Collections.timeEntries,
  Collections.workBreaks,
  Collections.timeApprovalRequests,
  Collections.workSessions,
  Collections.notifications,
  Collections.tasks,
  Collections.taskTags,
  Collections.projects,
  Collections.employeeInvites,
  Collections.employees,
  Collections.users,
  Collections.appSettings,
  Collections.counters,
];

async function clearCollection(name: (typeof Collections)[keyof typeof Collections]) {
  const col = await getCollection(name);
  const before = await col.countDocuments({});
  const result = await col.deleteMany({});
  return { name, before, deleted: result.deletedCount };
}

export async function clearAllData(options: { recreateAdmin?: boolean } = {}) {
  const { recreateAdmin = false } = options;

  console.log("Clearing all documents from every collection...");
  console.log("Database:", process.env.MONGODB_DB_NAME ?? "tracker_app");
  await ensureSchema();

  const results = [];
  for (const name of CLEAR_ORDER) {
    results.push(await clearCollection(name));
  }

  for (const row of results) {
    if (row.before > 0) {
      console.log(`  ${row.name}: ${row.before} removed`);
    }
  }

  const totalDeleted = results.reduce((sum, row) => sum + row.deleted, 0);
  console.log(`\nTotal documents removed: ${totalDeleted}`);

  if (recreateAdmin) {
    console.log("\nRecreating default admin...");
    await ensureDefaultAdmin();
  } else {
    console.log("\nCollections are empty. Run: npm run db:ensure-admin");
  }

  console.log("\nDone.");
}
