import { getMongoDb } from "../queries/mongo";
import { getCollection, updateById } from "../queries/mongo";
import { Collections } from "@db/mongo/collections";
import type { UserDoc } from "@db/mongo/types";
import { ensureDefaultOrganizationMigration } from "./tenant";

const ALL_COLLECTIONS = Object.values(Collections);
const GRIDFS_COLLECTIONS = [
  "employee_files.files",
  "employee_files.chunks",
  "task_files.files",
  "task_files.chunks",
] as const;

export async function ensureCollections() {
  const db = await getMongoDb();
  const existing = new Set(
    (await db.listCollections().toArray()).map((c) => c.name),
  );

  for (const name of [...ALL_COLLECTIONS, ...GRIDFS_COLLECTIONS]) {
    if (!existing.has(name)) {
      await db.createCollection(name);
      console.log(`[mongo] Created collection: ${name}`);
    }
  }
}

export async function ensureIndexes() {
  const db = await getMongoDb();

  const specs: Array<{
    name: string;
    indexes: Array<{ key: Record<string, 1 | -1>; unique?: boolean; sparse?: boolean }>;
  }> = [
    {
      name: Collections.organizations,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { name: 1 } },
        { key: { workspaceType: 1 } },
        { key: { planStatus: 1 } },
      ],
    },
    {
      name: Collections.subscriptionPlans,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { slug: 1 }, unique: true },
        { key: { sortOrder: 1 } },
      ],
    },
    {
      name: Collections.users,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { email: 1 }, unique: true, sparse: true },
        { key: { unionId: 1 }, unique: true },
        { key: { role: 1 } },
        { key: { organizationId: 1 } },
        { key: { organizationId: 1, email: 1 } },
      ],
    },
    {
      name: Collections.employeeInvites,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { token: 1 }, unique: true },
        { key: { organizationId: 1 } },
      ],
    },
    {
      name: Collections.employees,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { userId: 1 }, unique: true },
        { key: { email: 1 }, unique: true },
        { key: { inviteId: 1 }, sparse: true },
        { key: { organizationId: 1 } },
      ],
    },
    {
      name: Collections.projects,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, createdAt: -1 } },
      ],
    },
    {
      name: Collections.projectMembers,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { projectId: 1, userId: 1 }, unique: true },
        { key: { userId: 1 } },
      ],
    },
    {
      name: Collections.tasks,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { projectId: 1 } },
        { key: { projectId: 1, createdAt: -1 } },
        { key: { assigneeId: 1, createdAt: -1 } },
        { key: { organizationId: 1, createdAt: -1 } },
      ],
    },
    {
      name: Collections.taskParticipants,
      indexes: [{ key: { id: 1 }, unique: true }, { key: { taskId: 1, userId: 1 }, unique: true }],
    },
    { name: Collections.subtasks, indexes: [{ key: { id: 1 }, unique: true }, { key: { taskId: 1 } }] },
    { name: Collections.taskTags, indexes: [{ key: { id: 1 }, unique: true }, { key: { name: 1 }, unique: true }] },
    { name: Collections.taskTagRelations, indexes: [{ key: { id: 1 }, unique: true }, { key: { taskId: 1 } }] },
    {
      name: Collections.timeEntries,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { userId: 1 } },
        { key: { taskId: 1 } },
        { key: { userId: 1, taskId: 1, clockOut: 1 } },
      ],
    },
    {
      name: Collections.taskActivity,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { taskId: 1 } },
        { key: { taskId: 1, createdAt: -1 } },
      ],
    },
    {
      name: Collections.taskAttachments,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { taskId: 1 } },
        { key: { taskId: 1, createdAt: -1 } },
      ],
    },
    {
      name: Collections.employeeDocuments,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { userId: 1, createdAt: -1 } },
        { key: { organizationId: 1 } },
      ],
    },
    {
      name: Collections.formerEmployees,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, lastWorkingDay: -1 } },
        { key: { organizationId: 1, name: 1 } },
      ],
    },
    {
      name: Collections.formerEmployeeDocuments,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { formerEmployeeId: 1, createdAt: -1 } },
        { key: { organizationId: 1 } },
      ],
    },
    {
      name: Collections.customers,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, displayName: 1 } },
        { key: { organizationId: 1, email: 1 } },
      ],
    },
    {
      name: Collections.invoices,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, invoiceNumber: 1 } },
        { key: { organizationId: 1, customerId: 1 } },
        { key: { organizationId: 1, createdAt: -1 } },
      ],
    },
    {
      name: Collections.bankAccounts,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, name: 1 } },
        { key: { organizationId: 1, createdAt: -1 } },
      ],
    },
    {
      name: Collections.ledgerAccounts,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, code: 1 }, unique: true },
        { key: { organizationId: 1, type: 1 } },
      ],
    },
    {
      name: Collections.estimates,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, estimateNumber: 1 } },
        { key: { organizationId: 1, createdAt: -1 } },
      ],
    },
    {
      name: Collections.payments,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, paymentDate: -1 } },
        { key: { organizationId: 1, invoiceId: 1 } },
      ],
    },
    {
      name: Collections.expenses,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, expenseDate: -1 } },
      ],
    },
    {
      name: Collections.contracts,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, createdAt: -1 } },
      ],
    },
    {
      name: Collections.vendorBills,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, dueDate: 1 } },
        { key: { organizationId: 1, status: 1 } },
      ],
    },
    {
      name: Collections.dashboardReminders,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, userId: 1, dateKey: 1 } },
        { key: { userId: 1, dateKey: 1 } },
      ],
    },
    {
      name: Collections.notifications,
      indexes: [{ key: { id: 1 }, unique: true }, { key: { userId: 1 } }],
    },
    {
      name: Collections.workSessions,
      indexes: [{ key: { id: 1 }, unique: true }, { key: { userId: 1, active: 1 } }],
    },
    {
      name: Collections.workBreaks,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { userId: 1, startTime: -1 } },
        { key: { workSessionId: 1 } },
      ],
    },
    {
      name: Collections.timeApprovalRequests,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { userId: 1, status: 1 } },
        { key: { workSessionId: 1, type: 1, status: 1 } },
        { key: { workBreakId: 1, status: 1 } },
      ],
    },
    {
      name: Collections.leaveUsageOverrides,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { userId: 1, year: 1, month: 1 }, unique: true },
        { key: { year: 1 } },
      ],
    },
    {
      name: Collections.orgAttendanceQr,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1 }, unique: true },
        { key: { token: 1 }, unique: true },
      ],
    },
    {
      name: Collections.orgAttendanceQrActivity,
      indexes: [
        { key: { id: 1 }, unique: true },
        { key: { organizationId: 1, createdAt: -1 } },
      ],
    },
  ];

  for (const { name, indexes } of specs) {
    const col = db.collection(name);
    await Promise.all(
      indexes.map((index) => {
        const options: { unique?: boolean; sparse?: boolean } = {};
        if (index.unique) options.unique = true;
        if (index.sparse) options.sparse = true;
        return col.createIndex(index.key, options);
      }),
    );
  }
}

/**
 * Clean duplicate open attendance / active sessions left by concurrent clock-ins,
 * and remove zero-duration junk rows that inflated weekly totals.
 */
async function ensureAttendanceDuplicateCleanup() {
  const settings = await getCollection<{ _id: string; done?: boolean }>(Collections.appSettings);
  const flag = await settings.findOne({ _id: "attendance_duplicate_cleanup_v1" });
  if (flag?.done) return;

  const timeCol = await getCollection<{
    id: number;
    userId: number;
    taskId: number | null;
    clockIn: Date;
    clockOut: Date | null;
    note?: string | null;
  }>(Collections.timeEntries);
  const sessionCol = await getCollection<{
    id: number;
    userId: number;
    active: boolean;
    startTime: Date;
  }>(Collections.workSessions);

  const openEntries = await timeCol
    .find({ taskId: null, clockOut: null })
    .sort({ clockIn: 1, id: 1 })
    .toArray();

  const openByUser = new Map<number, typeof openEntries>();
  for (const entry of openEntries) {
    const list = openByUser.get(entry.userId) ?? [];
    list.push(entry);
    openByUser.set(entry.userId, list);
  }

  for (const [, entries] of openByUser) {
    if (entries.length <= 1) continue;
    const duplicateIds = entries.slice(1).map((e) => e.id);
    await timeCol.deleteMany({ id: { $in: duplicateIds } });
  }

  const activeSessions = await sessionCol
    .find({ active: true })
    .sort({ startTime: 1, id: 1 })
    .toArray();
  const sessionsByUser = new Map<number, typeof activeSessions>();
  for (const session of activeSessions) {
    const list = sessionsByUser.get(session.userId) ?? [];
    list.push(session);
    sessionsByUser.set(session.userId, list);
  }

  const now = new Date();
  for (const [, sessions] of sessionsByUser) {
    if (sessions.length <= 1) continue;
    await sessionCol.updateMany(
      { id: { $in: sessions.slice(1).map((s) => s.id) } },
      {
        $set: {
          active: false,
          endTime: now,
          paused: false,
          accumulatedWorkSeconds: 0,
          workSegmentStartedAt: null,
          breakStartedAt: null,
        },
      },
    );
  }

  // Remove completed junk: zero-span rows, prior "Duplicate open entry closed" markers,
  // and short fragments fully contained in a longer attendance span for the same user.
  const completedAttendance = await timeCol
    .find({ taskId: null, clockOut: { $ne: null } })
    .toArray();

  const completedByUser = new Map<number, typeof completedAttendance>();
  for (const entry of completedAttendance) {
    const list = completedByUser.get(entry.userId) ?? [];
    list.push(entry);
    completedByUser.set(entry.userId, list);
  }

  const junkIds: number[] = [];
  for (const [, entries] of completedByUser) {
    const sorted = [...entries].sort((a, b) => {
      const spanA =
        new Date(a.clockOut!).getTime() - new Date(a.clockIn).getTime();
      const spanB =
        new Date(b.clockOut!).getTime() - new Date(b.clockIn).getTime();
      return spanB - spanA || a.id - b.id;
    });

    const keptIds = new Set<number>();
    for (const entry of sorted) {
      const note = entry.note ?? "";
      const start = new Date(entry.clockIn).getTime();
      const end = new Date(entry.clockOut!).getTime();
      const span = end - start;

      if (/Duplicate open entry closed/i.test(note) || span <= 0) {
        junkIds.push(entry.id);
        continue;
      }

      const isJunk = [...keptIds].some((keptId) => {
        const other = entries.find((e) => e.id === keptId)!;
        const otherStart = new Date(other.clockIn).getTime();
        const otherEnd = new Date(other.clockOut!).getTime();
        if (start >= otherStart && end <= otherEnd) return true;
        if (span > 60_000) return false;
        return Math.min(end, otherEnd) - Math.max(start, otherStart) > 0;
      });

      if (isJunk) junkIds.push(entry.id);
      else keptIds.add(entry.id);
    }
  }

  if (junkIds.length > 0) {
    for (let i = 0; i < junkIds.length; i += 500) {
      await timeCol.deleteMany({ id: { $in: junkIds.slice(i, i + 500) } });
    }
  }

  // Enforce at most one open attendance row and one active session per user.
  try {
    await timeCol.createIndex(
      { userId: 1 },
      {
        unique: true,
        partialFilterExpression: { taskId: null, clockOut: null },
        name: "uniq_open_attendance_per_user",
      },
    );
  } catch (error) {
    console.warn("[mongo] Could not create uniq_open_attendance_per_user:", error);
  }

  try {
    await sessionCol.createIndex(
      { userId: 1 },
      {
        unique: true,
        partialFilterExpression: { active: true },
        name: "uniq_active_session_per_user",
      },
    );
  } catch (error) {
    console.warn("[mongo] Could not create uniq_active_session_per_user:", error);
  }

  await settings.updateOne(
    { _id: "attendance_duplicate_cleanup_v1" },
    { $set: { done: true, updatedAt: new Date(), junkRemoved: junkIds.length } },
    { upsert: true },
  );
}

export async function bootstrapMongo() {
  await ensureCollections();
  await ensureIndexes();
  await ensureAttendanceDuplicateCleanup();
  await ensureDefaultOrganizationMigration();
  await ensureEmployeeProjectViewPermission();
}

async function ensureEmployeeProjectViewPermission() {
  const settings = await getCollection<{ _id: string; done?: boolean }>(Collections.appSettings);
  const flag = await settings.findOne({ _id: "employee_projects_view_v1" });
  if (flag?.done) return;

  const col = await getCollection<UserDoc>(Collections.users);
  const employees = await col
    .find({ role: "employee", permissions: { $nin: ["projects.view"] } })
    .project({ id: 1, permissions: 1 })
    .toArray();

  await Promise.all(
    employees.map((employee) =>
      updateById<UserDoc>(Collections.users, employee.id, {
        permissions: [...(employee.permissions ?? []), "projects.view"],
        updatedAt: new Date(),
      }),
    ),
  );

  await settings.updateOne(
    { _id: "employee_projects_view_v1" },
    { $set: { done: true, updatedAt: new Date() } },
    { upsert: true },
  );
}
