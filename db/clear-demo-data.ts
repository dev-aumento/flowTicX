import "dotenv/config";
import { ensureSchema } from "../api/lib/migrate";
import { getCollection } from "../api/queries/mongo";
import { Collections } from "./mongo/collections";
import type { UserDoc } from "./mongo/types";
import { DEFAULT_PERMISSIONS_BY_ROLE } from "./mongo/types";
import { updateById } from "../api/queries/mongo";

const DEMO_EMAIL_DOMAIN = "@aumento.io";

function isDemoUser(user: Pick<UserDoc, "email" | "unionId">) {
  const email = user.email?.toLowerCase() ?? "";
  return email.endsWith(DEMO_EMAIL_DOMAIN);
}

async function deleteManyByUserIds(
  collection: (typeof Collections)[keyof typeof Collections],
  field: string,
  userIds: number[],
) {
  if (userIds.length === 0) return 0;
  const col = await getCollection(collection);
  const result = await col.deleteMany({ [field]: { $in: userIds } });
  return result.deletedCount;
}

async function main() {
  console.log("Removing demo / seed data from MongoDB...");
  await ensureSchema();

  const usersCol = await getCollection<UserDoc>(Collections.users);
  const allUsers = await usersCol.find({}).toArray();
  const demoUsers = allUsers.filter(isDemoUser);
  const demoUserIds = demoUsers.map((u) => u.id);

  if (demoUserIds.length === 0) {
    console.log("No demo users found — nothing to remove.");
    return;
  }

  console.log(`Demo users to remove (${demoUserIds.length}):`);
  for (const user of demoUsers) {
    console.log(`  - ${user.email ?? user.unionId} (id=${user.id})`);
  }

  const tasksCol = await getCollection(Collections.tasks);
  const demoTasksByUsers = await tasksCol
    .find({
      $or: [
        { assigneeId: { $in: demoUserIds } },
        { createdBy: { $in: demoUserIds } },
      ],
    })
    .toArray();
  const demoTaskIds = [...new Set(demoTasksByUsers.map((t) => t.id))];

  const projectsCol = await getCollection(Collections.projects);
  const demoProjectsByUsers = await projectsCol
    .find({ createdBy: { $in: demoUserIds } })
    .toArray();
  const demoProjectIds = [...new Set(demoProjectsByUsers.map((p) => p.id))];

  if (demoTaskIds.length > 0) {
    const taskFilter = { taskId: { $in: demoTaskIds } };
    const participants = await getCollection(Collections.taskParticipants);
    const subtasks = await getCollection(Collections.subtasks);
    const activity = await getCollection(Collections.taskActivity);
    const attachments = await getCollection(Collections.taskAttachments);
    const tagRelations = await getCollection(Collections.taskTagRelations);
    const timeEntries = await getCollection(Collections.timeEntries);

    await participants.deleteMany(taskFilter);
    await subtasks.deleteMany(taskFilter);
    await activity.deleteMany(taskFilter);
    await attachments.deleteMany(taskFilter);
    await tagRelations.deleteMany(taskFilter);
    await timeEntries.deleteMany(taskFilter);
    await tasksCol.deleteMany({ id: { $in: demoTaskIds } });
    console.log(`Removed ${demoTaskIds.length} demo task(s) and related records.`);
  }

  if (demoProjectIds.length > 0) {
    await projectsCol.deleteMany({ id: { $in: demoProjectIds } });
    console.log(`Removed ${demoProjectIds.length} demo project(s).`);
  }

  await deleteManyByUserIds(Collections.employees, "userId", demoUserIds);
  await deleteManyByUserIds(Collections.notifications, "userId", demoUserIds);
  await deleteManyByUserIds(Collections.notifications, "actorId", demoUserIds);
  await deleteManyByUserIds(Collections.timeEntries, "userId", demoUserIds);
  await deleteManyByUserIds(Collections.workSessions, "userId", demoUserIds);
  await deleteManyByUserIds(Collections.employeeInvites, "invitedBy", demoUserIds);

  const usersResult = await usersCol.deleteMany({ id: { $in: demoUserIds } });
  console.log(`Removed ${usersResult.deletedCount} demo user(s).`);

  let remainingAdmins = await usersCol.countDocuments({ role: "admin", status: "active" });
  if (remainingAdmins === 0) {
    const realUser = await usersCol.findOne({
      email: { $not: /@aumento\.io$/i },
      status: "active",
    });
    if (realUser) {
      await updateById<UserDoc>(Collections.users, realUser.id, {
        role: "admin",
        permissions: DEFAULT_PERMISSIONS_BY_ROLE.admin,
        updatedAt: new Date(),
      });
      console.log(`\nPromoted ${realUser.email} to admin (no admin remained after cleanup).`);
      remainingAdmins = 1;
    } else {
      console.log(
        "\nWarning: No active admin users remain. Run: npm run db:ensure-admin",
      );
    }
  }

  const realUsers = await usersCol.countDocuments({});
  const realEmployees = await getCollection(Collections.employees).then((c) => c.countDocuments({}));
  const realProjects = await projectsCol.countDocuments({});
  const realTasks = await tasksCol.countDocuments({});

  console.log("\nRemaining real data:");
  console.log(`  users: ${realUsers}`);
  console.log(`  employees: ${realEmployees}`);
  console.log(`  projects: ${realProjects}`);
  console.log(`  tasks: ${realTasks}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
