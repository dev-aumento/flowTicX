import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { isAuthDisabled } from "./lib/dev-mode";
import { assertPermission } from "./lib/permissions";
import * as mock from "./lib/mock-store";
import {
  getCollection,
  countDocs,
  hasMongoConfigured,
} from "./queries/connection";
import { Collections } from "@db/mongo/collections";
import type {
  BankAccountDoc,
  EmployeeDoc,
  ExpenseDoc,
  InvoiceDoc,
  LeaveRequestDoc,
  ProjectDoc,
  TaskDoc,
  TimeEntryDoc,
  UserDoc,
  WorkSessionDoc,
} from "@db/mongo/types";
import { ensureSchema } from "./lib/migrate";
import { orgFilter, findOrganizationById, requireOrganizationId } from "./lib/tenant";
import { loadOrgTaskStatusLabels } from "./lib/org-task-status-labels";
import { assignedTaskStatusCountRows } from "@/lib/task-status-labels";
import {
  computeSessionWorkSeconds,
  REQUIRED_DAILY_HOURS,
  startOfCalendarWeek,
} from "@/lib/work-hours-policy";
import { leaveTypeShort, isHrRoleOnly, eachLeaveDateKey, isWeekdayDateKey, isWorkFromHomeLeave, isAdminOrManagement, isFinanceRoleOnly } from "@/lib/leave-policy";
import { isCountedInWorkforce } from "./queries/employees";
import {
  HR_OVERVIEW_DEPARTMENT_LABELS,
  normalizeHrOverviewDepartment,
} from "@/lib/department-options";
import {
  calendarYmdFromUnknown,
  calendarYmdKey,
  formatInWorkZone,
  formatWorkZoneDateKey,
  startOfWorkZoneDay,
  workZoneDateKey,
  workZoneDateParts,
  workZoneWallTimeToUtc,
  type CalendarYmd,
} from "@/lib/timezone";
import { invoiceBalanceDue, invoiceTotal, isInvoiceOutstanding, normalizeCurrencyCode } from "@/lib/invoice-store";
import { ensureSampleEmployeesOnce } from "./lib/sample-workspace";

function roundHours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

function hoursDeltaPct(current: number, previous: number) {
  if (previous > 0) return Math.round(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
}

function dateKeyToUtcRange(key: string, endOfDay: boolean) {
  const [year, month, day] = key.split("-").map(Number);
  return workZoneWallTimeToUtc(
    year || 1970,
    month || 1,
    day || 1,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
}

function shiftDateKey(key: string, deltaDays: number) {
  const [year, month, day] = key.split("-").map(Number);
  const utc = workZoneWallTimeToUtc(year || 1970, month || 1, day || 1, 12, 0, 0, 0);
  utc.setTime(utc.getTime() + deltaDays * 86400000);
  return workZoneDateKey(utc);
}

function countWeekdayKeys(startKey: string, endKey: string) {
  let count = 0;
  let key = startKey;
  while (key <= endKey) {
    if (isWeekdayDateKey(key)) count += 1;
    key = shiftDateKey(key, 1);
  }
  return Math.max(count, 0);
}

function resolveHrDashboardPeriod(
  input: { startDate?: string; endDate?: string } | undefined,
  now: Date,
) {
  const nowParts = workZoneDateParts(now);
  const todayKey = workZoneDateKey(now);
  const periodEndKey =
    input?.endDate && input.endDate <= todayKey ? input.endDate : todayKey;
  const monthStart = `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-01`;
  const periodStartKey =
    input?.startDate && input.startDate <= periodEndKey ? input.startDate : monthStart;
  const periodDays = Math.max(
    1,
    Math.floor(
      (dateKeyToUtcRange(periodEndKey, true).getTime() -
        dateKeyToUtcRange(periodStartKey, false).getTime()) /
        86400000,
    ) + 1,
  );
  const prevPeriodEndKey = shiftDateKey(periodStartKey, -1);
  const prevPeriodStartKey = shiftDateKey(prevPeriodEndKey, -(periodDays - 1));
  return {
    periodStartKey,
    periodEndKey,
    periodStart: dateKeyToUtcRange(periodStartKey, false),
    periodEnd: dateKeyToUtcRange(periodEndKey, true),
    prevPeriodStart: dateKeyToUtcRange(prevPeriodStartKey, false),
    prevPeriodEnd: dateKeyToUtcRange(prevPeriodEndKey, true),
    weekdaysElapsed: countWeekdayKeys(periodStartKey, periodEndKey),
    prevWeekdays: countWeekdayKeys(prevPeriodStartKey, prevPeriodEndKey),
  };
}

async function sumDuration(
  filter: Record<string, unknown>,
): Promise<number> {
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const result = await timeCol
    .aggregate<{ total: number }>([
      { $match: filter },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$duration", 0] } } } },
    ])
    .toArray();
  return result[0]?.total ?? 0;
}

function assertHrOrAdmin(user: { role?: string | null; department?: string | null }) {
  if (!(isHrRoleOnly(user) || isAdminOrManagement(user))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This dashboard is only available to HR, admin, and management users",
    });
  }
}

function assertFinanceOrAdmin(user: { role?: string | null }) {
  if (!(isFinanceRoleOnly(user) || String(user.role ?? "").toLowerCase() === "admin")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This dashboard is only available to finance managers and admins",
    });
  }
}

const ACTIVE_USER_STATUSES = ["active", "Active"] as const;

function nextBirthdayYmd(dob: CalendarYmd, nowParts: CalendarYmd): CalendarYmd {
  let year = nowParts.year;
  if (
    dob.month < nowParts.month ||
    (dob.month === nowParts.month && dob.day < nowParts.day)
  ) {
    year += 1;
  }
  return { year, month: dob.month, day: dob.day };
}

function daysUntilYmd(next: CalendarYmd, nowParts: CalendarYmd) {
  const nowUtc = workZoneWallTimeToUtc(nowParts.year, nowParts.month, nowParts.day, 0, 0, 0, 0);
  const nextUtc = workZoneWallTimeToUtc(next.year, next.month, next.day, 0, 0, 0, 0);
  return Math.round((nextUtc.getTime() - nowUtc.getTime()) / 86400000);
}

/** True when the next birthday falls in the current calendar month or the following month. */
function isNextBirthdayInCurrentOrNextMonth(next: CalendarYmd, nowParts: CalendarYmd) {
  const nextMonth = nowParts.month === 12 ? 1 : nowParts.month + 1;
  const nextMonthYear = nowParts.month === 12 ? nowParts.year + 1 : nowParts.year;
  return (
    (next.year === nowParts.year && next.month === nowParts.month) ||
    (next.year === nextMonthYear && next.month === nextMonth)
  );
}

type BirthdayPerson = {
  id: number;
  name?: string | null;
  avatar?: string | null;
  position?: string | null;
  department?: string | null;
  dateOfBirth?: unknown;
};

type BirthdayEmployee = {
  userId: number;
  name?: string | null;
  avatar?: string | null;
  position?: string | null;
  department?: string | null;
  dateOfBirth?: unknown;
  joinedAt?: Date | null;
};

type UpcomingBirthdayItem = {
  id: number;
  name: string;
  avatar: string | null;
  position: string;
  daysLeft: number;
  dateLabel: string;
  isToday: boolean;
};

function mapUpcomingBirthdays(
  activeUsers: BirthdayPerson[],
  employeeByUserId: {
    get(userId: number): BirthdayEmployee | undefined;
    values(): Iterable<BirthdayEmployee>;
  },
  nowParts: CalendarYmd,
): UpcomingBirthdayItem[] {
  const dobByUserId = new Map<number, CalendarYmd>();
  for (const u of activeUsers) {
    const parts = calendarYmdFromUnknown(u.dateOfBirth);
    if (parts) dobByUserId.set(u.id, parts);
  }
  for (const emp of employeeByUserId.values()) {
    if (dobByUserId.has(emp.userId)) continue;
    const parts = calendarYmdFromUnknown(emp.dateOfBirth);
    if (parts) dobByUserId.set(emp.userId, parts);
  }

  return activeUsers
    .filter((u) => dobByUserId.has(u.id))
    .flatMap((u) => {
      const dob = dobByUserId.get(u.id)!;
      const next = nextBirthdayYmd(dob, nowParts);
      if (!isNextBirthdayInCurrentOrNextMonth(next, nowParts)) return [];
      const daysLeft = daysUntilYmd(next, nowParts);
      const emp = employeeByUserId.get(u.id);
      return [
        {
          id: u.id,
          name: u.name || emp?.name || "Employee",
          avatar: u.avatar ?? emp?.avatar ?? null,
          position: (
            emp?.position ||
            u.position ||
            emp?.department ||
            u.department ||
            "Team member"
          ).trim(),
          daysLeft,
          dateLabel: formatWorkZoneDateKey(calendarYmdKey(next), {
            day: "numeric",
            month: "short",
          }),
          isToday: daysLeft === 0,
        },
      ];
    })
    .sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}

async function buildUpcomingBirthdays(
  organizationId: number,
  now: Date = new Date(),
) {
  const tenant = { organizationId };
  const userCol = await getCollection<UserDoc>(Collections.users);
  const employeeCol = await getCollection<EmployeeDoc>(Collections.employees);
  const nowParts = workZoneDateParts(now);

  const [activeUsersRaw, employeeRows] = await Promise.all([
    userCol
      .find({ status: { $in: ACTIVE_USER_STATUSES }, ...tenant })
      .project({
        id: 1,
        name: 1,
        avatar: 1,
        department: 1,
        position: 1,
        role: 1,
        dateOfBirth: 1,
      })
      .toArray(),
    employeeCol
      .find({ ...tenant })
      .project({
        userId: 1,
        dateOfBirth: 1,
        department: 1,
        position: 1,
        name: 1,
        avatar: 1,
      })
      .toArray(),
  ]);

  const activeUsers = activeUsersRaw.filter((u) => isCountedInWorkforce(u));
  const employeeByUserId = new Map(
    employeeRows.map((e) => [e.userId as number, e as BirthdayEmployee]),
  );
  return mapUpcomingBirthdays(activeUsers as BirthdayPerson[], employeeByUserId, nowParts);
}

function leaveTypeSummaryLabel(leaveType: string) {
  if (leaveType === "paid") return "Paid";
  if (leaveType === "sick") return "Sick";
  if (leaveType === "unpaid") return "Unpaid";
  if (leaveType === "wfh") return "Work from home";
  return "Half day";
}

type UpcomingLeaveSummaryItem = {
  id: string;
  leaveId: number;
  day: number;
  dateKey: string;
  section: "today" | "tomorrow" | "upcoming";
  name: string;
  avatar: string | null;
  leaveType: string;
  leaveTypeLabel: string;
};

async function buildLeaveSummary(
  organizationId: number,
  now: Date = new Date(),
) {
  const leaveCol = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
  const userCol = await getCollection<UserDoc>(Collections.users);
  const tenant = { organizationId };

  const todayKey = workZoneDateKey(now);
  const startToday = startOfWorkZoneDay(now);
  const startTomorrow = new Date(startToday.getTime() + 86400000);
  const tomorrowKey = workZoneDateKey(startTomorrow);
  const leaveMonthLabel = formatInWorkZone(now, { month: "long" });

  // Leaves: approved only (same as before). WFH: pending + approved so they appear in the summary.
  const leaveRequests = await leaveCol
    .find({
      ...tenant,
      status: { $in: ["approved", "pending"] },
      endDate: { $gte: todayKey },
    })
    .toArray();

  const leaveUserIds = [...new Set(leaveRequests.map((l) => l.userId))];
  const leaveUsers =
    leaveUserIds.length > 0
      ? await userCol
          .find({ id: { $in: leaveUserIds }, ...tenant })
          .project({ id: 1, name: 1, avatar: 1 })
          .toArray()
      : [];
  const leaveUserById = new Map(leaveUsers.map((u) => [u.id, u]));

  const upcomingLeaveItems: UpcomingLeaveSummaryItem[] = [];
  const upcomingWfhItems: UpcomingLeaveSummaryItem[] = [];

  for (const l of leaveRequests) {
    const isWfh = isWorkFromHomeLeave(l.leaveType);
    if (!isWfh && l.status !== "approved") continue;

    const rangeStart = l.startDate < todayKey ? todayKey : l.startDate;
    for (const dateKey of eachLeaveDateKey(rangeStart, l.endDate)) {
      if (!isWeekdayDateKey(dateKey) || dateKey < todayKey) continue;

      const user = leaveUserById.get(l.userId);
      const section =
        dateKey === todayKey
          ? "today"
          : dateKey === tomorrowKey
            ? "tomorrow"
            : "upcoming";

      const item: UpcomingLeaveSummaryItem = {
        id: `${l.id}-${dateKey}`,
        leaveId: l.id,
        day: Number(dateKey.slice(8, 10)),
        dateKey,
        section,
        name: user?.name || "Employee",
        avatar: user?.avatar ?? null,
        leaveType: leaveTypeShort(l.leaveType),
        leaveTypeLabel: leaveTypeSummaryLabel(l.leaveType),
      };

      if (isWfh) {
        upcomingWfhItems.push(item);
      } else {
        upcomingLeaveItems.push(item);
      }
    }
  }

  upcomingLeaveItems.sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.name.localeCompare(b.name),
  );
  upcomingWfhItems.sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.name.localeCompare(b.name),
  );

  return {
    leaveMonthLabel,
    upcomingLeaves: upcomingLeaveItems,
    upcomingWfh: upcomingWfhItems,
  };
}

export const dashboardRouter = createRouter({
  getStats: authedQuery
    .query(async ({ ctx }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockDashboardStats(ctx.user.id, ctx.user.role);
      }

      await ensureSchema();
      const userId = ctx.user.id;
      const tenant = orgFilter(ctx.user);
      const isAdminOrManager =
        ctx.user.role === "admin" || ctx.user.role === "manager" || ctx.user.role === "client";
      const startOfToday = startOfWorkZoneDay(new Date());
      const taskCol = await getCollection<TaskDoc>(Collections.tasks);

      const taskFilter = isAdminOrManager
        ? { ...tenant }
        : { ...tenant, assigneeId: userId };

      const [ongoingTasks, completedTasks, hoursTotal] = await Promise.all([
        taskCol.countDocuments({ ...taskFilter, status: "todo" }),
        taskCol.countDocuments({ ...taskFilter, status: "done" }),
        sumDuration({ ...tenant, userId, clockIn: { $gte: startOfToday } }),
      ]);

      return {
        ongoingTasks,
        completedTasks,
        hoursTracked: Math.round((hoursTotal / 60) * 10) / 10,
      };
    }),

  getRecentTasks: authedQuery
    .input(z.object({ limit: z.number().default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit || 10;
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockRecentTasks(ctx.user.id, limit);
      }

      await ensureSchema();
      const tenant = orgFilter(ctx.user);
      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const recentTasks = await taskCol
        .find({ ...tenant, assigneeId: ctx.user.id })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray();

      const assigneeIds = [
        ...new Set(recentTasks.map((t) => t.assigneeId).filter((id): id is number => id != null)),
      ];

      const userCol = await getCollection<UserDoc>(Collections.users);
      const assignees = assigneeIds.length > 0
        ? await userCol.find({ id: { $in: assigneeIds }, ...tenant }).toArray()
        : [];

      return recentTasks.map((task) => ({
        ...task,
        assignee: assignees.find((a) => a.id === task.assigneeId) || null,
      }));
    }),

  getWeeklyActivity: authedQuery
    .query(async ({ ctx }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) return mock.mockWeeklyActivity();

      await ensureSchema();
      const tenant = orgFilter(ctx.user);
      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const days: { day: string; completed: number; created: number }[] = [];

      for (let i = 6; i >= 0; i--) {
        const parts = workZoneDateParts(new Date());
        const date = workZoneWallTimeToUtc(parts.year, parts.month, parts.day - i, 0, 0, 0, 0);
        const nextDay = workZoneWallTimeToUtc(
          parts.year,
          parts.month,
          parts.day - i + 1,
          0,
          0,
          0,
          0,
        );

        const [completed, created] = await Promise.all([
          taskCol.countDocuments({
            ...tenant,
            assigneeId: ctx.user.id,
            status: "done",
            updatedAt: { $gte: date, $lt: nextDay },
          }),
          taskCol.countDocuments({
            ...tenant,
            createdBy: ctx.user.id,
            createdAt: { $gte: date, $lt: nextDay },
          }),
        ]);

        days.push({
          day: formatInWorkZone(date, { weekday: "short" }),
          completed,
          created,
        });
      }

      return days;
    }),

  getWorkload: authedQuery
    .query(async ({ ctx }) => {
      assertPermission(ctx.user, "analytics.view");

      if (isAuthDisabled() || !hasMongoConfigured()) return mock.mockWorkload();

      await ensureSchema();
      const userCol = await getCollection<UserDoc>(Collections.users);
      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const allUsers = (
        await userCol
          .find({ status: "active", ...orgFilter(ctx.user) })
          .toArray()
      ).filter((user) => String(user.role ?? "").toLowerCase() !== "admin");
      const weekStart = startOfCalendarWeek();

      const workload = await Promise.all(
        allUsers.map(async (user) => {
          const [taskCount, hoursTotal] = await Promise.all([
            taskCol.countDocuments({
              assigneeId: user.id,
              status: "in_progress",
              ...orgFilter(ctx.user),
            }),
            sumDuration({
              userId: user.id,
              clockIn: { $gte: weekStart },
              ...orgFilter(ctx.user),
            }),
          ]);

          return {
            userId: user.id,
            name: user.name || "Unknown",
            avatar: user.avatar,
            role: user.role,
            taskCount,
            hoursLogged: Math.round((hoursTotal / 60) * 10) / 10,
          };
        })
      );

      return workload;
    }),

  getAdminStats: authedQuery
    .query(async ({ ctx }) => {
      assertPermission(ctx.user, "analytics.view");

      if (isAuthDisabled() || !hasMongoConfigured()) return mock.mockAdminStats();

      await ensureSchema();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
      const tenant = orgFilter(ctx.user);

      const [activeStaffUsers, activeProjects, totalTasks, weeklyHoursTotal, activeClockInUserIds] =
        await Promise.all([
          (await getCollection<UserDoc>(Collections.users))
            .find({ status: { $in: ACTIVE_USER_STATUSES }, ...tenant })
            .project({ id: 1, role: 1 })
            .toArray(),
          countDocs(Collections.projects, { status: "active", ...tenant }),
          countDocs(Collections.tasks, tenant),
          sumDuration({ clockIn: { $gte: weekAgo }, ...tenant }),
          sessionCol.distinct("userId", { active: true }),
        ]);

      const totalEmployees = activeStaffUsers.filter((u) => isCountedInWorkforce(u)).length;

      // Only count active sessions for users in this organization.
      const userCol = await getCollection<UserDoc>(Collections.users);
      const orgUserIds = new Set(
        (
          await userCol
            .find({ id: { $in: activeClockInUserIds }, ...tenant })
            .project({ id: 1 })
            .toArray()
        ).map((u) => u.id),
      );
      const activeClockIns = activeClockInUserIds.filter((id) => orgUserIds.has(id)).length;

      return {
        totalEmployees,
        activeProjects,
        totalTasks,
        weeklyHours: Math.round((weeklyHoursTotal / 60) * 10) / 10,
        activeClockIns,
      };
    }),

  /** Counts of tasks assigned to employees, grouped by status. */
  getAssignedTaskStatusCounts: authedQuery.query(async ({ ctx }) => {
    assertPermission(ctx.user, "analytics.view");

    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockAssignedTaskStatusCounts();
    }

    await ensureSchema();
    const tenant = orgFilter(ctx.user);
    const taskCol = await getCollection<TaskDoc>(Collections.tasks);
    const assigned = await taskCol
      .find(
        { ...tenant, assigneeId: { $gt: 0 } },
        { projection: { status: 1, _id: 0 } },
      )
      .toArray();

    const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };
    for (const task of assigned) {
      if (task.status in counts) {
        counts[task.status as keyof typeof counts] += 1;
      }
    }

    return assignedTaskStatusCountRows(
      counts,
      await loadOrgTaskStatusLabels(requireOrganizationId(ctx.user)),
    );
  }),

  /** Employees currently clocked in (active work sessions). */
  getActiveClockIns: authedQuery.query(async ({ ctx }) => {
    assertPermission(ctx.user, "analytics.view");

    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockActiveClockIns();
    }

    await ensureSchema();
    const tenant = orgFilter(ctx.user);
    const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
    const userCol = await getCollection<UserDoc>(Collections.users);

    const sessions = await sessionCol
      .find({ active: true })
      .sort({ startTime: 1 })
      .toArray();

    if (sessions.length === 0) return [];

    // Duplicate active sessions can exist for one user; keep one row per employee.
    const sessionByUserId = new Map<number, (typeof sessions)[number]>();
    for (const session of sessions) {
      const existing = sessionByUserId.get(session.userId);
      if (!existing) {
        sessionByUserId.set(session.userId, session);
        continue;
      }
      const existingStart = new Date(existing.startTime).getTime();
      const sessionStart = new Date(session.startTime).getTime();
      if (
        sessionStart < existingStart ||
        (sessionStart === existingStart && session.id < existing.id)
      ) {
        sessionByUserId.set(session.userId, session);
      }
    }
    const uniqueSessions = [...sessionByUserId.values()].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );

    const userIds = uniqueSessions.map((s) => s.userId);
    const users = await userCol
      .find({ id: { $in: userIds }, ...tenant })
      .toArray();
    const userById = new Map(users.map((u) => [u.id, u]));

    return uniqueSessions
      .filter((session) => userById.has(session.userId))
      .map((session) => {
        const user = userById.get(session.userId)!;
        return {
          sessionId: session.id,
          userId: session.userId,
          name: user.name || "Unknown",
          avatar: user.avatar ?? null,
          role: user.role ?? "employee",
          department: user.department ?? null,
          startTime: session.startTime,
          paused: !!session.paused,
          workElapsedSeconds: computeSessionWorkSeconds(session),
        };
      });
  }),

  /** Workforce overview for the HR dashboard and admin dashboard detail cards. */
  getHrDashboard: authedQuery
    .input(
      z
        .object({
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
    assertHrOrAdmin(ctx.user);

    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockHrDashboard();
    }

    await ensureSchema();
    const tenant = orgFilter(ctx.user);
    try {
      await ensureSampleEmployeesOnce(tenant.organizationId);
    } catch (error) {
      console.error("[dashboard] Sample employees were not created:", error);
    }
    const userCol = await getCollection<UserDoc>(Collections.users);
    const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
    const leaveCol = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
    const employeeCol = await getCollection<EmployeeDoc>(Collections.employees);

    const now = new Date();
    const todayKey = workZoneDateKey(now);
    const nowParts = workZoneDateParts(now);
    const period = resolveHrDashboardPeriod(input, now);
    const startToday = startOfWorkZoneDay(now);
    const startTomorrow = new Date(startToday.getTime() + 86400000);

    const [activeUsersRaw, employeeRows] = await Promise.all([
      userCol
        .find({ status: { $in: ACTIVE_USER_STATUSES }, ...tenant })
        .project({
          id: 1,
          name: 1,
          avatar: 1,
          department: 1,
          position: 1,
          role: 1,
          dateOfBirth: 1,
          createdAt: 1,
        })
        .toArray(),
      employeeCol
        .find({ ...tenant })
        .project({
          userId: 1,
          dateOfBirth: 1,
          joinedAt: 1,
          department: 1,
          position: 1,
          name: 1,
          avatar: 1,
        })
        .toArray(),
    ]);

    // Account managers / clients are staff directory users but not workforce headcount.
    const activeUsers = activeUsersRaw.filter((u) => isCountedInWorkforce(u));
    const employeeByUserId = new Map(
      employeeRows.map((e) => [e.userId, e as BirthdayEmployee]),
    );
    const orgUserIds = new Set(activeUsers.map((u) => u.id));
    const totalEmployees = activeUsers.length;

    // Anyone with a work session that started today (including already clocked out),
    // plus anyone still actively clocked in from an earlier day.
    const [sessionsToday, activeSessions] = await Promise.all([
      sessionCol
        .find({
          userId: { $in: [...orgUserIds] },
          startTime: { $gte: startToday, $lt: startTomorrow },
        })
        .project({ userId: 1 })
        .toArray(),
      sessionCol
        .find({ userId: { $in: [...orgUserIds] }, active: true })
        .project({ userId: 1 })
        .toArray(),
    ]);
    const presentIds = new Set<number>([
      ...sessionsToday.map((s) => s.userId),
      ...activeSessions.map((s) => s.userId),
    ]);
    const presentToday = presentIds.size;

    const approvedLeaves = await leaveCol
      .find({ status: "approved", ...tenant })
      .toArray();
    const onLeaveToday = new Set(
      approvedLeaves
        .filter((l) => l.startDate <= todayKey && l.endDate >= todayKey)
        .map((l) => l.userId),
    ).size;

    const yesterdayUtc = new Date(startToday.getTime() - 86400000);
    const yesterdayKey = workZoneDateKey(yesterdayUtc);
    const startYesterday = startOfWorkZoneDay(yesterdayUtc);
    const sessionsYesterday = await sessionCol
      .find({
        userId: { $in: [...orgUserIds] },
        startTime: { $gte: startYesterday, $lt: startToday },
      })
      .project({ userId: 1 })
      .toArray();
    const presentYesterday = new Set(sessionsYesterday.map((s) => s.userId)).size;
    const onLeaveYesterday = new Set(
      approvedLeaves
        .filter((l) => l.startDate <= yesterdayKey && l.endDate >= yesterdayKey)
        .map((l) => l.userId),
    ).size;

    const joinDateFor = (user: (typeof activeUsers)[number]) => {
      const emp = employeeByUserId.get(user.id);
      return emp?.joinedAt ?? user.createdAt;
    };

    const newJoinersThisMonth = activeUsers.filter((u) => {
      const joined = joinDateFor(u);
      return joined >= period.periodStart && joined <= period.periodEnd;
    }).length;
    const newJoinersLastMonth = activeUsers.filter((u) => {
      const joined = joinDateFor(u);
      return joined >= period.prevPeriodStart && joined <= period.prevPeriodEnd;
    }).length;

    const deptCounts = new Map<string, number>();
    for (const label of HR_OVERVIEW_DEPARTMENT_LABELS) {
      deptCounts.set(label, 0);
    }
    let staffInOverview = 0;
    for (const u of activeUsers) {
      const fromEmp = employeeByUserId.get(u.id)?.department;
      const label = normalizeHrOverviewDepartment(fromEmp ?? u.department);
      if (!label) continue;
      deptCounts.set(label, (deptCounts.get(label) ?? 0) + 1);
      staffInOverview += 1;
    }
    const departmentsCount = HR_OVERVIEW_DEPARTMENT_LABELS.filter(
      (label) => (deptCounts.get(label) ?? 0) > 0,
    ).length;

    const byDepartment = HR_OVERVIEW_DEPARTMENT_LABELS
      .map((name) => {
        const count = deptCounts.get(name) ?? 0;
        return {
          name,
          count,
          percent:
            staffInOverview > 0 ? Math.round((count / staffInOverview) * 100) : 0,
        };
      })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);

    const leaveSummary = await buildLeaveSummary(tenant.organizationId, now);

    const recentJoiners = [...activeUsers]
      .sort((a, b) => joinDateFor(b).getTime() - joinDateFor(a).getTime())
      .slice(0, 5)
      .map((u) => {
        const joined = joinDateFor(u);
        const emp = employeeByUserId.get(u.id);
        return {
          id: u.id,
          name: u.name || emp?.name || "Employee",
          avatar: u.avatar ?? emp?.avatar ?? null,
          position:
            (emp?.position || u.position || emp?.department || u.department || "Team member").trim(),
          joinedAt: joined,
          joinedLabel: formatInWorkZone(joined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        };
      });

    const upcomingBirthdays = mapUpcomingBirthdays(
      activeUsers as BirthdayPerson[],
      employeeByUserId,
      nowParts,
    );

    const presentPct =
      totalEmployees > 0 ? Math.round((presentToday / totalEmployees) * 100) : 0;
    const onLeavePct =
      totalEmployees > 0 ? Math.round((onLeaveToday / totalEmployees) * 100) : 0;

    const presentDeltaPct =
      presentYesterday > 0
        ? Math.round(((presentToday - presentYesterday) / presentYesterday) * 100)
        : presentToday > 0
          ? 100
          : 0;
    const onLeaveDeltaPct =
      onLeaveYesterday > 0
        ? Math.round(((onLeaveToday - onLeaveYesterday) / onLeaveYesterday) * 100)
        : onLeaveToday > 0
          ? 100
          : 0;
    const joinersDelta = newJoinersThisMonth - newJoinersLastMonth;

    // —— Project overview + month hours / finance metrics ——
    const projectCol = await getCollection<ProjectDoc>(Collections.projects);
    const taskCol = await getCollection<TaskDoc>(Collections.tasks);
    const [projects, overdueTaskProjectIds] = await Promise.all([
      projectCol
        .find({ ...tenant })
        .project({ id: 1, status: 1 })
        .toArray(),
      taskCol.distinct("projectId", {
        ...tenant,
        status: { $ne: "done" },
        dueDate: { $lt: now },
        projectId: { $ne: null },
      }),
    ]);
    const overdueProjectIdSet = new Set(
      (overdueTaskProjectIds as Array<number | null>)
        .filter((id): id is number => typeof id === "number" && id > 0),
    );

    let completedProjects = 0;
    let inProgressProjects = 0;
    let onHoldProjects = 0;
    let overdueProjects = 0;
    for (const project of projects) {
      const status = String(project.status ?? "").toLowerCase();
      if (status === "completed") {
        completedProjects += 1;
        continue;
      }
      if (status === "archived") {
        onHoldProjects += 1;
        continue;
      }
      // active (and any other open status)
      if (overdueProjectIdSet.has(project.id)) {
        overdueProjects += 1;
      } else {
        inProgressProjects += 1;
      }
    }
    const projectTotal =
      completedProjects + inProgressProjects + onHoldProjects + overdueProjects;
    const projectOverview = {
      total: projectTotal,
      byStatus: [
        { name: "Completed", count: completedProjects, color: "#2563EB" },
        { name: "In Progress", count: inProgressProjects, color: "#3B82F6" },
        { name: "On Hold", count: onHoldProjects, color: "#F59E0B" },
        { name: "Overdue", count: overdueProjects, color: "#EF4444" },
      ]
        .map((row) => ({
          ...row,
          percent:
            projectTotal > 0 ? Math.round((row.count / projectTotal) * 100) : 0,
        }))
        .filter((row) => row.count > 0),
    };

    const [
      totalMinutesThisMonth,
      trackedMinutesThisMonth,
      totalMinutesLastMonth,
      trackedMinutesLastMonth,
    ] = await Promise.all([
      sumDuration({
        ...tenant,
        taskId: null,
        clockIn: { $gte: period.periodStart, $lte: period.periodEnd },
      }),
      sumDuration({
        ...tenant,
        taskId: { $ne: null },
        clockIn: { $gte: period.periodStart, $lte: period.periodEnd },
      }),
      sumDuration({
        ...tenant,
        taskId: null,
        clockIn: { $gte: period.prevPeriodStart, $lte: period.prevPeriodEnd },
      }),
      sumDuration({
        ...tenant,
        taskId: { $ne: null },
        clockIn: { $gte: period.prevPeriodStart, $lte: period.prevPeriodEnd },
      }),
    ]);

    const totalHoursLogged = roundHours(totalMinutesThisMonth);
    const trackedHours = roundHours(trackedMinutesThisMonth);
    const billableHours = trackedHours;
    const totalHoursLastMonth = roundHours(totalMinutesLastMonth);
    const trackedHoursLastMonth = roundHours(trackedMinutesLastMonth);

    const trackableHeadcount = activeUsers.filter(
      (u) => !isAdminOrManagement(u) && !isHrRoleOnly(u),
    ).length;
    const capacityHours =
      Math.max(trackableHeadcount, 1) * period.weekdaysElapsed * REQUIRED_DAILY_HOURS;
    const teamUtilizationPct =
      capacityHours > 0
        ? Math.min(100, Math.round((totalHoursLogged / capacityHours) * 100))
        : 0;

    const lastCapacity =
      Math.max(trackableHeadcount, 1) * period.prevWeekdays * REQUIRED_DAILY_HOURS;
    const lastUtilization =
      lastCapacity > 0
        ? Math.min(100, Math.round((totalHoursLastMonth / lastCapacity) * 100))
        : 0;

    let pendingInvoicesAmount = 0;
    let pendingInvoicesCount = 0;
    let revenueThisMonth = 0;
    let revenueLastMonth = 0;
    const org = await findOrganizationById(tenant.organizationId);
    const metricsCurrency = normalizeCurrencyCode(org?.billingProfile?.baseCurrency);
    try {
      const invoiceCol = await getCollection<InvoiceDoc>(Collections.invoices);
      const invoices = await invoiceCol.find({ ...tenant }).toArray();
      for (const inv of invoices) {
        const total = invoiceTotal(inv);
        if (inv.status !== "paid") {
          pendingInvoicesAmount += invoiceBalanceDue(inv);
          pendingInvoicesCount += 1;
        }
        if (inv.status === "paid") {
          const paidAt = inv.updatedAt instanceof Date ? inv.updatedAt : new Date(inv.updatedAt);
          if (paidAt >= period.periodStart && paidAt <= period.periodEnd) {
            revenueThisMonth += total;
          } else if (paidAt >= period.prevPeriodStart && paidAt <= period.prevPeriodEnd) {
            revenueLastMonth += total;
          }
        }
      }
    } catch {
      // Invoices collection may be unavailable in some envs — metrics stay zero.
    }

    const monthMetrics = {
      totalHoursLogged,
      totalHoursDeltaPct: hoursDeltaPct(totalHoursLogged, totalHoursLastMonth),
      trackedHours,
      trackedHoursPct:
        totalHoursLogged > 0
          ? Math.round((trackedHours / totalHoursLogged) * 100)
          : 0,
      trackedHoursDeltaPct: hoursDeltaPct(trackedHours, trackedHoursLastMonth),
      billableHours,
      billablePct:
        totalHoursLogged > 0
          ? Math.round((billableHours / totalHoursLogged) * 100)
          : 0,
      teamUtilizationPct,
      utilizationDeltaPct: teamUtilizationPct - lastUtilization,
      pendingInvoicesAmount: Math.round(pendingInvoicesAmount),
      pendingInvoicesCount,
      revenueThisMonth: Math.round(revenueThisMonth),
      revenueDeltaPct: hoursDeltaPct(revenueThisMonth, revenueLastMonth),
      currency: metricsCurrency,
    };

    return {
      totalEmployees,
      presentToday,
      presentPct,
      presentDeltaPct,
      onLeaveToday,
      onLeavePct,
      onLeaveDeltaPct,
      newJoinersThisMonth,
      joinersDelta,
      departmentsCount,
      overviewStaffTotal: staffInOverview,
      byDepartment,
      projectOverview,
      monthMetrics,
      leaveMonthLabel: leaveSummary.leaveMonthLabel,
      upcomingLeaves: leaveSummary.upcomingLeaves,
      upcomingWfh: leaveSummary.upcomingWfh,
      recentJoiners,
      upcomingBirthdays,
    };
  }),

  /** Upcoming leave summary + birthdays (this month & next) for any signed-in user. */
  getLeaveSummary: authedQuery.query(async ({ ctx }) => {
    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockLeaveSummary();
    }
    await ensureSchema();
    const organizationId = orgFilter(ctx.user).organizationId;
    const now = new Date();
    const [summary, upcomingBirthdays] = await Promise.all([
      buildLeaveSummary(organizationId, now),
      buildUpcomingBirthdays(organizationId, now),
    ]);
    return { ...summary, upcomingBirthdays };
  }),

  /** Finance overview: invoices + accounts dashboard widgets. */
  getFinanceDashboard: authedQuery
    .input(
      z
        .object({
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
    assertFinanceOrAdmin(ctx.user);
    assertPermission(ctx.user, "invoices.manage");

    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockFinanceDashboard();
    }

    await ensureSchema();
    const tenant = orgFilter(ctx.user);
    const invoiceCol = await getCollection<InvoiceDoc>(Collections.invoices);
    const expenseCol = await getCollection<ExpenseDoc>(Collections.expenses);
    const [invoices, expenseDocs] = await Promise.all([
      invoiceCol.find({ ...tenant }).sort({ createdAt: -1 }).toArray(),
      expenseCol.find({ ...tenant }).toArray(),
    ]);

    const now = new Date();
    const nowParts = workZoneDateParts(now);
    const todayKey = workZoneDateKey(now);
    const periodEndKey = input?.endDate && input.endDate <= todayKey ? input.endDate : todayKey;
    const periodStartKey =
      input?.startDate && input.startDate <= periodEndKey
        ? input.startDate
        : `${nowParts.year}-01-01`;
    const periodStartParts = (() => {
      const [y, m, d] = periodStartKey.split("-").map(Number);
      return { year: y || nowParts.year, month: m || 1, day: d || 1 };
    })();
    const periodEndParts = (() => {
      const [y, m, d] = periodEndKey.split("-").map(Number);
      return { year: y || nowParts.year, month: m || nowParts.month, day: d || nowParts.day };
    })();
    const periodStart = workZoneWallTimeToUtc(
      periodStartParts.year,
      periodStartParts.month,
      periodStartParts.day,
      0,
      0,
      0,
      0,
    );
    const periodEnd = workZoneWallTimeToUtc(
      periodEndParts.year,
      periodEndParts.month,
      periodEndParts.day,
      23,
      59,
      59,
      999,
    );
    const periodDays = Math.max(
      1,
      Math.floor((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1,
    );
    const prevPeriodEnd = new Date(periodStart.getTime() - 1);
    const prevPeriodStart = new Date(prevPeriodEnd.getTime() - (periodDays - 1) * 86400000);
    const thisMonthStartDate = workZoneWallTimeToUtc(
      nowParts.year,
      nowParts.month,
      1,
      0,
      0,
      0,
      0,
    );
    const lastMonthStartParts = {
      year: nowParts.month === 1 ? nowParts.year - 1 : nowParts.year,
      month: nowParts.month === 1 ? 12 : nowParts.month - 1,
    };
    const lastMonthStartDate = workZoneWallTimeToUtc(
      lastMonthStartParts.year,
      lastMonthStartParts.month,
      1,
      0,
      0,
      0,
      0,
    );

    let currency = "INR";
    let revenueYtd = 0;
    let receivedYtd = 0;
    let outstandingAmount = 0;
    let revenueLastYearYtd = 0;
    let receivedLastYearYtd = 0;
    let outstandingLastMonth = 0;

    const thisYearMonthly = Array.from({ length: 12 }, () => 0);
    const lastYearMonthly = Array.from({ length: 12 }, () => 0);

    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    const outstandingRows: Array<{
      id: number;
      invoiceNumber: string;
      customerName: string;
      dueDate: string;
      amount: number;
      daysOverdue: number;
      currency: string;
    }> = [];
    const upcomingInvoices: Array<{
      id: number;
      invoiceNumber: string;
      customerName: string;
      dueDate: string;
      amount: number;
      currency: string;
    }> = [];
    const recentTransactions: Array<{
      id: string;
      date: string;
      type: string;
      description: string;
      amount: number;
      status: string;
      statusTone: "received" | "paid" | "sent" | "draft";
      href?: string;
    }> = [];

    const daysBetweenKeys = (fromKey: string, toKey: string) => {
      const a = Date.parse(`${fromKey}T12:00:00Z`);
      const b = Date.parse(`${toKey}T12:00:00Z`);
      if (Number.isNaN(a) || Number.isNaN(b)) return 0;
      return Math.floor((b - a) / 86400000);
    };

    const inSelectedPeriod = (dateKey: string) =>
      dateKey >= periodStartKey && dateKey <= periodEndKey;

    const thisMonthPrefix = `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-`;
    const cashInflowByDay = new Map<string, number>();
    const cashOutflowByDay = new Map<string, number>();
    const addCashDay = (map: Map<string, number>, dateKey: string, amount: number) => {
      if (!dateKey.startsWith(thisMonthPrefix) || dateKey > todayKey) return;
      map.set(dateKey, (map.get(dateKey) ?? 0) + amount);
    };

    for (const inv of invoices) {
      const total = invoiceTotal(inv);
      currency = inv.currency || currency;
      const invoiceDate = inv.invoiceDate || todayKey;
      const invParts = (() => {
        const [y, m] = invoiceDate.split("-").map(Number);
        return { year: y || nowParts.year, month: m || nowParts.month };
      })();

      if (inv.status === "paid" || isInvoiceOutstanding(inv.status)) {
        if (inSelectedPeriod(invoiceDate)) {
          revenueYtd += total;
        }
        // Keep calendar-year monthly overview for the chart (current/previous year).
        if (invParts.year === nowParts.year) {
          if (invParts.month >= 1 && invParts.month <= 12) {
            thisYearMonthly[invParts.month - 1] += total;
          }
        } else if (invParts.year === nowParts.year - 1) {
          if (invParts.month >= 1 && invParts.month <= 12) {
            lastYearMonthly[invParts.month - 1] += total;
          }
        }
        // Previous equal-length period for trend chips.
        if (invoiceDate < periodStartKey) {
          const invTs = Date.parse(`${invoiceDate}T12:00:00Z`);
          if (
            !Number.isNaN(invTs) &&
            invTs >= prevPeriodStart.getTime() &&
            invTs <= prevPeriodEnd.getTime()
          ) {
            revenueLastYearYtd += total;
          }
        }
      }

      if (inv.status === "paid") {
        const paidAt =
          inv.updatedAt instanceof Date ? inv.updatedAt : new Date(inv.updatedAt);
        const paidKey = workZoneDateKey(paidAt);
        if (inSelectedPeriod(paidKey)) receivedYtd += total;
        if (paidAt >= prevPeriodStart && paidAt <= prevPeriodEnd) {
          receivedLastYearYtd += total;
        }
        addCashDay(cashInflowByDay, paidKey, total);

        if (inSelectedPeriod(paidKey)) {
          recentTransactions.push({
            id: `paid-${inv.id}`,
            date: formatInWorkZone(paidAt, { day: "2-digit", month: "short", year: "numeric" }),
            type: "Payment Received",
            description: `${inv.invoiceNumber} · ${inv.customerName}`,
            amount: Math.round(total),
            status: "Received",
            statusTone: "received",
            href: `/admin/invoices/${inv.id}`,
          });
        }
      }

      if (isInvoiceOutstanding(inv.status)) {
        const dueAmount = invoiceBalanceDue(inv);
        outstandingAmount += dueAmount;
        const due = inv.dueDate || invoiceDate;
        const daysOverdue = Math.max(0, daysBetweenKeys(due, todayKey));
        if (due < todayKey) {
          if (daysOverdue <= 30) aging.d0_30 += dueAmount;
          else if (daysOverdue <= 60) aging.d31_60 += dueAmount;
          else if (daysOverdue <= 90) aging.d61_90 += dueAmount;
          else aging.d90_plus += dueAmount;
        } else {
          aging.d0_30 += dueAmount;
          upcomingInvoices.push({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            customerName: inv.customerName,
            dueDate: due,
            amount: Math.round(dueAmount),
            currency: inv.currency || currency,
          });
        }
        outstandingRows.push({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          dueDate: due,
          amount: Math.round(dueAmount),
          daysOverdue,
          currency: inv.currency || currency,
        });

        const created =
          inv.createdAt instanceof Date ? inv.createdAt : new Date(inv.createdAt);
        if (created >= lastMonthStartDate && created < thisMonthStartDate) {
          outstandingLastMonth += dueAmount;
        }

        if (inSelectedPeriod(workZoneDateKey(created))) {
          recentTransactions.push({
            id: `sent-${inv.id}`,
            date: formatInWorkZone(created, { day: "2-digit", month: "short", year: "numeric" }),
            type: "Invoice Sent",
            description: `${inv.invoiceNumber} · ${inv.customerName}`,
            amount: Math.round(total),
            status: "Sent",
            statusTone: "sent",
            href: `/admin/invoices/${inv.id}`,
          });
        }
      }
    }

    const EXPENSE_COLORS = ["#2563EB", "#0EA5E9", "#F59E0B", "#8B5CF6", "#EC4899", "#94A3B8"];
    let expensesYtd = 0;
    let expensesLastYear = 0;
    const expensesByCategory = new Map<string, number>();

    for (const expense of expenseDocs) {
      if (expense.status !== "recorded") continue;
      const dateKey = expense.expenseDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey ?? "")) continue;
      const amount = (expense.amount ?? 0) + (expense.taxAmount ?? 0);
      if (amount <= 0) continue;

      if (inSelectedPeriod(dateKey)) {
        expensesYtd += amount;
        const category = (expense.category || "General").trim() || "General";
        expensesByCategory.set(category, (expensesByCategory.get(category) ?? 0) + amount);
        addCashDay(cashOutflowByDay, dateKey, amount);
        recentTransactions.push({
          id: `exp-${expense.id}`,
          date: formatInWorkZone(
            workZoneWallTimeToUtc(
              Number(dateKey.slice(0, 4)),
              Number(dateKey.slice(5, 7)),
              Number(dateKey.slice(8, 10)),
              12,
              0,
              0,
              0,
            ),
            { day: "2-digit", month: "short", year: "numeric" },
          ),
          type: "Expense",
          description: expense.vendorName
            ? `${category} · ${expense.vendorName}`
            : category,
          amount: -Math.round(amount),
          status: "Paid",
          statusTone: "paid",
          href: "/finance/expenses",
        });
      }

      if (dateKey < periodStartKey) {
        const expenseTs = Date.parse(`${dateKey}T12:00:00Z`);
        if (
          !Number.isNaN(expenseTs) &&
          expenseTs >= prevPeriodStart.getTime() &&
          expenseTs <= prevPeriodEnd.getTime()
        ) {
          expensesLastYear += amount;
        }
      }
    }

    expensesYtd = Math.round(expensesYtd);
    expensesLastYear = Math.round(expensesLastYear);
    const netProfitYtd = Math.round(receivedYtd - expensesYtd);
    const netProfitLastYear = Math.round(receivedLastYearYtd - expensesLastYear);
    const bankCol = await getCollection<BankAccountDoc>(Collections.bankAccounts);
    const bankDocs = await bankCol
      .find({ ...tenant, isActive: { $ne: false } })
      .sort({ createdAt: -1 })
      .toArray();
    const bankAccounts = bankDocs.map((bank) => {
      const digits = String(bank.accountNumber ?? "").replace(/\D/g, "");
      const mask = digits.length >= 4 ? `•••• ${digits.slice(-4)}` : digits ? `•••• ${digits}` : "—";
      const label =
        bank.bankName && bank.name
          ? `${bank.bankName} — ${bank.name}`
          : bank.name || bank.bankName || "Bank account";
      return {
        id: bank.id,
        name: label,
        mask,
        balance: Math.round(bank.currentBalance ?? 0),
      };
    });
    const cashInBank = bankAccounts.reduce((sum, bank) => sum + bank.balance, 0);

    const expenseBreakdown = [...expensesByCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount], i) => ({
        name,
        amount: Math.round(amount),
        percent:
          expensesYtd > 0 ? Math.round((amount / expensesYtd) * 1000) / 10 : 0,
        color: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
      }));

    const monthLabels = Array.from({ length: 12 }, (_, i) =>
      formatInWorkZone(workZoneWallTimeToUtc(nowParts.year, i + 1, 1, 12, 0, 0, 0), {
        month: "short",
      }),
    );
    const revenueOverview = monthLabels.map((label, i) => ({
      label,
      thisYear: Math.round(thisYearMonthly[i]),
      lastYear: Math.round(lastYearMonthly[i]),
    }));

    const daysInMonth = new Date(nowParts.year, nowParts.month, 0).getDate();
    const cashFlowDaily = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateKey = `${thisMonthPrefix}${String(day).padStart(2, "0")}`;
      const inflow = Math.round(cashInflowByDay.get(dateKey) ?? 0);
      const outflow = Math.round(cashOutflowByDay.get(dateKey) ?? 0);
      return {
        label: String(day),
        net: inflow - outflow,
        inflow,
        outflow,
      };
    }).filter((row) => Number(row.label) <= nowParts.day);
    const cashInflows = cashFlowDaily.reduce((s, d) => s + d.inflow, 0);
    const cashOutflows = cashFlowDaily.reduce((s, d) => s + d.outflow, 0);

    upcomingInvoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    outstandingRows.sort((a, b) => b.daysOverdue - a.daysOverdue);
    recentTransactions.sort((a, b) => b.date.localeCompare(a.date));

    const agingTotal =
      aging.d0_30 + aging.d31_60 + aging.d61_90 + aging.d90_plus || outstandingAmount || 1;

    return {
      currency,
      period: {
        startDate: periodStartKey,
        endDate: periodEndKey,
      },
      totalRevenueYtd: Math.round(revenueYtd),
      revenueYoYPct: hoursDeltaPct(revenueYtd, revenueLastYearYtd),
      totalReceivedYtd: Math.round(receivedYtd),
      receivedYoYPct: hoursDeltaPct(receivedYtd, receivedLastYearYtd),
      outstandingReceivable: Math.round(outstandingAmount),
      outstandingMoMPct: hoursDeltaPct(outstandingAmount, outstandingLastMonth),
      totalExpensesYtd: expensesYtd,
      expensesYoYPct: hoursDeltaPct(expensesYtd, expensesLastYear),
      netProfitYtd,
      netProfitYoYPct: hoursDeltaPct(netProfitYtd, netProfitLastYear),
      cashInBank,
      revenueOverview,
      incomeVsExpense: {
        income: Math.round(revenueYtd),
        expense: expensesYtd,
        incomePct:
          revenueYtd + expensesYtd > 0
            ? Math.round((revenueYtd / (revenueYtd + expensesYtd)) * 1000) / 10
            : 0,
        expensePct:
          revenueYtd + expensesYtd > 0
            ? Math.round((expensesYtd / (revenueYtd + expensesYtd)) * 1000) / 10
            : 0,
      },
      cashFlow: {
        daily: cashFlowDaily,
        net: cashInflows - cashOutflows,
        inflows: cashInflows,
        outflows: cashOutflows,
      },
      outstandingSummary: {
        total: Math.round(outstandingAmount),
        d0_30: Math.round(aging.d0_30),
        d31_60: Math.round(aging.d31_60),
        d61_plus: Math.round(aging.d61_90 + aging.d90_plus),
      },
      outstandingInvoices: outstandingRows.slice(0, 8),
      recentTransactions: recentTransactions.slice(0, 8),
      expenseBreakdown,
      receivableAging: [
        {
          label: "0-30 days",
          amount: Math.round(aging.d0_30),
          percent: Math.round((aging.d0_30 / agingTotal) * 1000) / 10,
        },
        {
          label: "31-60 days",
          amount: Math.round(aging.d31_60),
          percent: Math.round((aging.d31_60 / agingTotal) * 1000) / 10,
        },
        {
          label: "61-90 days",
          amount: Math.round(aging.d61_90),
          percent: Math.round((aging.d61_90 / agingTotal) * 1000) / 10,
        },
        {
          label: "90+ days",
          amount: Math.round(aging.d90_plus),
          percent: Math.round((aging.d90_plus / agingTotal) * 1000) / 10,
        },
      ],
      upcomingInvoices: upcomingInvoices.slice(0, 5),
      bankAccounts,
    };
  }),
});
