import {
  buildDaySnapshotsFromEntries,
  calendarMonthBounds,
  classifyMonthAttendance,
  type MonthAttendanceSummary,
} from "@/lib/month-attendance";
import { buildLeaveCoverageMap, isAttendanceTrackableUser } from "@/lib/leave-policy";
import {
  computeAttendanceWorkSeconds,
  localDateKey,
} from "@/lib/work-hours-policy";
import { workZoneDateParts, workZoneWallTimeToUtc } from "@/lib/timezone";
import { Collections } from "@db/mongo/collections";
import type {
  LeaveRequestDoc,
  PublicHolidayDoc,
  TimeEntryDoc,
  UserDoc,
  WorkBreakDoc,
  WorkSessionDoc,
} from "@db/mongo/types";
import { getCollection, hasMongoConfigured } from "../queries/connection";
import { isAuthDisabled } from "./dev-mode";
import * as mock from "./mock-store";

async function loadHolidayDateKeysForMonth(
  year: number,
  month: number,
  organizationId?: number | null,
): Promise<string[]> {
  const { startKey, endKey } = calendarMonthBounds(year, month);
  const holidayCol = await getCollection<PublicHolidayDoc>(Collections.publicHolidays);
  const filter: Record<string, unknown> = {
    date: { $gte: startKey, $lte: endKey },
  };
  if (organizationId != null) {
    filter.$or = [{ organizationId }, { organizationId: null }];
  }
  const holidays = await holidayCol.find(filter).project({ date: 1 }).toArray();
  return [...new Set(holidays.map((h) => h.date).filter(Boolean))];
}

export async function computeUserMonthAttendance(
  userId: number,
  year: number,
  month: number,
  now = new Date(),
): Promise<MonthAttendanceSummary> {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    return mock.mockMonthAttendance(userId, year, month, now);
  }

  const { end, endKey } = calendarMonthBounds(year, month);
  const lookbackStart = workZoneWallTimeToUtc(year, month, 1 - 14, 0, 0, 0, 0);
  const lookbackStartKey = localDateKey(lookbackStart);

  const userCol = await getCollection<UserDoc>(Collections.users);
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const leaveCol = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
  const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
  const breakCol = await getCollection<WorkBreakDoc>(Collections.workBreaks);

  const user = await userCol.findOne(
    { id: userId },
    { projection: { organizationId: 1 } },
  );

  const [entries, leaves, session, breaks, holidayDateKeys] = await Promise.all([
    timeCol
      .find({
        userId,
        taskId: null,
        clockIn: { $gte: lookbackStart, $lte: end },
      })
      .toArray(),
    leaveCol
      .find({
        userId,
        status: "approved",
        startDate: { $lte: endKey },
        endDate: { $gte: lookbackStartKey },
      })
      .toArray(),
    sessionCol.findOne({ userId, active: true }, { sort: { startTime: 1, id: 1 } }),
    breakCol
      .find({
        userId,
        startTime: { $lt: end },
        $or: [{ endTime: { $gt: lookbackStart } }, { endTime: null }],
      })
      .toArray(),
    loadHolidayDateKeysForMonth(year, month, user?.organizationId),
  ]);

  let liveSession: { startTime: Date; workSeconds: number } | null = null;
  if (
    session?.active &&
    session.startTime >= lookbackStart &&
    session.startTime <= end
  ) {
    const workSeconds = computeAttendanceWorkSeconds(
      session.startTime,
      now,
      breaks.filter((b) => {
        if (b.startTime >= now) return false;
        const bend = b.endTime ?? now;
        return bend > session.startTime;
      }),
      now,
    );
    liveSession = { startTime: session.startTime, workSeconds };
  }

  const days = buildDaySnapshotsFromEntries({
    userId,
    entries,
    breaks,
    leaveByDate: buildLeaveCoverageMap(leaves),
    now,
    liveSession,
  });

  return classifyMonthAttendance(year, month, days, {
    asOf: now,
    leaves,
    holidayDateKeys,
  });
}

export async function computeTeamMonthAttendance(
  year: number,
  month: number,
  now = new Date(),
  organizationId?: number | null,
): Promise<
  Array<{
    userId: number;
    name: string;
    email: string | null;
    avatar: string | null;
    department: string | null;
    role: string;
    attendance: MonthAttendanceSummary;
  }>
> {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    return mock.mockTeamMonthAttendance(year, month, now);
  }

  const { end, endKey } = calendarMonthBounds(year, month);
  const lookbackStart = workZoneWallTimeToUtc(year, month, 1 - 14, 0, 0, 0, 0);
  const lookbackStartKey = localDateKey(lookbackStart);

  const userCol = await getCollection<UserDoc>(Collections.users);
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const leaveCol = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
  const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
  const breakCol = await getCollection<WorkBreakDoc>(Collections.workBreaks);

  const userFilter: Record<string, unknown> = { status: "active" };
  if (organizationId != null) {
    userFilter.organizationId = organizationId;
  }

  const allUsers = await userCol
    .find(userFilter)
    .project({
      id: 1,
      name: 1,
      email: 1,
      avatar: 1,
      department: 1,
      role: 1,
      organizationId: 1,
    })
    .toArray();

  const trackableUsers = allUsers.filter((u) => isAttendanceTrackableUser(u));
  const userIds = trackableUsers.map((u) => u.id);
  if (userIds.length === 0) return [];

  const holidayOrgId =
    organizationId ??
    trackableUsers.find((u) => u.organizationId != null)?.organizationId ??
    null;

  const [entries, leaves, sessions, breaks, holidayDateKeys] = await Promise.all([
    timeCol
      .find({
        userId: { $in: userIds },
        taskId: null,
        clockIn: { $gte: lookbackStart, $lte: end },
      })
      .toArray(),
    leaveCol
      .find({
        userId: { $in: userIds },
        status: "approved",
        startDate: { $lte: endKey },
        endDate: { $gte: lookbackStartKey },
      })
      .toArray(),
    sessionCol.find({ userId: { $in: userIds }, active: true }).toArray(),
    breakCol
      .find({
        userId: { $in: userIds },
        startTime: { $lt: end },
        $or: [{ endTime: { $gt: lookbackStart } }, { endTime: null }],
      })
      .toArray(),
    loadHolidayDateKeysForMonth(year, month, holidayOrgId),
  ]);

  const entriesByUser = new Map<number, TimeEntryDoc[]>();
  for (const e of entries) {
    const list = entriesByUser.get(e.userId) ?? [];
    list.push(e);
    entriesByUser.set(e.userId, list);
  }

  const leavesByUser = new Map<number, LeaveRequestDoc[]>();
  for (const l of leaves) {
    const list = leavesByUser.get(l.userId) ?? [];
    list.push(l);
    leavesByUser.set(l.userId, list);
  }

  const sessionByUser = new Map<number, WorkSessionDoc>();
  for (const s of sessions) {
    const existing = sessionByUser.get(s.userId);
    if (!existing || s.startTime < existing.startTime) {
      sessionByUser.set(s.userId, s);
    }
  }

  const breaksByUser = new Map<number, WorkBreakDoc[]>();
  for (const b of breaks) {
    const list = breaksByUser.get(b.userId) ?? [];
    list.push(b);
    breaksByUser.set(b.userId, list);
  }

  return trackableUsers
    .map((user) => {
      const userBreaks = breaksByUser.get(user.id) ?? [];
      const session = sessionByUser.get(user.id);
      let liveSession: { startTime: Date; workSeconds: number } | null = null;
      if (
        session?.active &&
        session.startTime >= lookbackStart &&
        session.startTime <= end
      ) {
        const workSeconds = computeAttendanceWorkSeconds(
          session.startTime,
          now,
          userBreaks.filter((b) => {
            if (b.startTime >= now) return false;
            const bend = b.endTime ?? now;
            return bend > session.startTime;
          }),
          now,
        );
        liveSession = { startTime: session.startTime, workSeconds };
      }

      const userLeaves = leavesByUser.get(user.id) ?? [];
      const days = buildDaySnapshotsFromEntries({
        userId: user.id,
        entries: entriesByUser.get(user.id) ?? [],
        breaks: userBreaks,
        leaveByDate: buildLeaveCoverageMap(userLeaves),
        now,
        liveSession,
      });

      return {
        userId: user.id,
        name: user.name || "Unknown",
        email: user.email ?? null,
        avatar: user.avatar ?? null,
        department: user.department ?? null,
        role: user.role,
        attendance: classifyMonthAttendance(year, month, days, {
          asOf: now,
          leaves: userLeaves,
          holidayDateKeys,
        }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveMonthInput(
  input: { year?: number; month?: number } | undefined,
  now = new Date(),
) {
  const parts = workZoneDateParts(now);
  return {
    year: input?.year ?? parts.year,
    month: input?.month ?? parts.month,
  };
}
