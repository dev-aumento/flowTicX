import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, managerQuery, adminOrHrQuery } from "./middleware";
import { assertPlanFeature } from "./lib/plan-guard";
import { isAuthDisabled } from "./lib/dev-mode";
import { assertPermission, hasPermission } from "./lib/permissions";
import * as mock from "./lib/mock-store";
import {
  buildTimeStatsSummary,
  localDateKey,
  periodClockInBounds,
  dayBounds,
  roundHours,
  resolveAttendanceDisplaySeconds,
  filterMeaningfulAttendanceEntries,
  sumBreakSecondsInWindow,
} from "@/lib/work-hours-policy";
import { buildLeaveCoverageMap, canManageAttendance, isAttendanceTrackableUser } from "@/lib/leave-policy";
import {
  getCollection,
  insertDoc,
  updateById,
  countDocs,
  hasMongoConfigured,
} from "./queries/connection";
import { Collections } from "@db/mongo/collections";
import type { LeaveRequestDoc, TimeEntryDoc, UserDoc, WorkSessionDoc, WorkBreakDoc, TimeApprovalRequestDoc } from "@db/mongo/types";
import { ensureSchema } from "./lib/migrate";
import { closeOpenWorkBreak, openWorkBreak } from "./lib/work-breaks";
import { notifyAdmins } from "./lib/notify-admins";
import { orgFilter, requireOrganizationId } from "./lib/tenant";
import {
  clockOutAttendanceAtTime,
  hasOpenAttendanceState,
  runAutoClockOutForUser,
} from "./lib/auto-clock-out";
import { pauseAllRunningTaskTimersForUser } from "./lib/task-timers";
import {
  computeStoredAttendanceDurationSeconds,
  findBreaksOverlappingWindow,
  sumCompletedAttendanceSecondsForEntries,
  refreshAttendanceEntriesOverlappingBreak,
  resyncActiveSessionFromBreaks,
} from "./lib/attendance-breaks";
import { formatWorkZoneTime } from "@/lib/timezone";
import { assertClockInWithinGeofence } from "./location-router";
import {
  applyBreakApproval,
  applyClockInApproval,
  findPendingClockInRequest,
  findClockInRequestForSession,
  notifyUserOfTimeReview,
  validateManualClockInRequest,
} from "./lib/time-approvals";
import {
  computeTeamMonthAttendance,
  computeUserMonthAttendance,
  resolveMonthInput,
} from "./lib/month-attendance-compute";

function assertLeaveManager(user: {
  role?: string | null;
  department?: string | null;
  permissions?: string[] | null;
}) {
  if (!canManageAttendance(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only HR and admins can view team attendance",
    });
  }
}

type SessionPauseFields = Pick<
  WorkSessionDoc,
  "paused" | "accumulatedWorkSeconds" | "breakStartedAt" | "workSegmentStartedAt"
>;

function sessionBreakElapsedSeconds(state: SessionPauseFields, now = new Date()) {
  return state.breakStartedAt
    ? Math.floor((now.getTime() - state.breakStartedAt.getTime()) / 1000)
    : 0;
}

/** Live worked seconds for an open session: clock-in → now minus all breaks. */
async function liveSessionWorkSeconds(
  userId: number,
  sessionStart: Date,
  now = new Date(),
) {
  return computeStoredAttendanceDurationSeconds(userId, sessionStart, now, now);
}

async function enrichSession(session: WorkSessionDoc, now = new Date()) {
  const workElapsedSeconds = await liveSessionWorkSeconds(
    session.userId,
    session.startTime,
    now,
  );
  return {
    ...session,
    paused: session.paused,
    workElapsedSeconds,
    breakElapsedSeconds: sessionBreakElapsedSeconds(session, now),
  };
}

async function attachSessionApprovalInfo<T extends WorkSessionDoc>(
  session: T & { workElapsedSeconds: number; breakElapsedSeconds: number },
) {
  const existing = await findClockInRequestForSession(session.id);
  return {
    ...session,
    clockInRequest: existing
      ? {
          id: existing.id,
          requestedClockIn: existing.requestedClockIn!,
          reason: existing.reason,
          status: existing.status,
        }
      : null,
    pendingClockInRequest:
      existing?.status === "pending"
        ? {
            id: existing.id,
            requestedClockIn: existing.requestedClockIn!,
            reason: existing.reason,
          }
        : null,
  };
}

async function findActiveSession(userId: number) {
  const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
  return sessionCol.findOne({ userId, active: true }, { sort: { startTime: 1, id: 1 } });
}

async function attendanceLiveSeconds(
  userId: number,
  dateStr: string,
  entries: TimeEntryDoc[],
  now: Date,
) {
  const session = await findActiveSession(userId);
  if (session && localDateKey(session.startTime) === dateStr) {
    return liveSessionWorkSeconds(userId, session.startTime, now);
  }

  const openAttendance = pickPrimaryOpenAttendance(entries);
  if (openAttendance) {
    return computeStoredAttendanceDurationSeconds(
      userId,
      openAttendance.clockIn,
      now,
      now,
    );
  }

  return 0;
}

/** Prefer the earliest open attendance entry for a day (avoids duplicate open rows). */
function pickPrimaryOpenAttendance<T extends { id: number; clockIn: Date; clockOut?: Date | null }>(
  entries: T[],
): T | null {
  const open = entries.filter((e) => !e.clockOut);
  if (open.length === 0) return null;
  return open.reduce((best, entry) =>
    entry.clockIn.getTime() < best.clockIn.getTime() ||
    (entry.clockIn.getTime() === best.clockIn.getTime() && entry.id < best.id)
      ? entry
      : best,
  );
}

async function completedAttendanceSecondsForDay(
  userId: number,
  dateStr: string,
  now = new Date(),
) {
  const { start, end } = dayBounds(dateStr);
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const entries = await timeCol
    .find({
      userId,
      taskId: null,
      clockIn: { $gte: start, $lte: end },
      clockOut: { $ne: null },
    })
    .toArray();

  return sumCompletedAttendanceSecondsForEntries(userId, entries, now);
}

async function sumAttendanceDaySeconds(
  userId: number,
  entries: TimeEntryDoc[],
  attendanceLiveSeconds: number,
  now = new Date(),
) {
  let totalSeconds = await sumCompletedAttendanceSecondsForEntries(
    userId,
    entries.filter((e) => e.clockOut),
    now,
  );

  // Live session time must only be counted once, even if duplicate open entries exist.
  if (attendanceLiveSeconds > 0) {
    totalSeconds += attendanceLiveSeconds;
  }

  return totalSeconds;
}

function displayAttendanceDurationSeconds(
  entry: TimeEntryDoc,
  attendanceLiveSeconds: number,
  isPrimaryOpen: boolean,
) {
  if (entry.clockOut) return null;
  if (isPrimaryOpen && attendanceLiveSeconds > 0) {
    return attendanceLiveSeconds;
  }
  return null;
}

async function buildDayHoursForUser(userId: number, dateStr: string, now = new Date()) {
  const { start, end } = dayBounds(dateStr);
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const entries = await timeCol
    .find({
      userId,
      taskId: null,
      clockIn: { $gte: start, $lte: end },
    })
    .sort({ clockIn: 1 })
    .toArray();

  const primaryOpen = pickPrimaryOpenAttendance(entries);
  const meaningful = filterMeaningfulAttendanceEntries(entries);
  const completedEntries = meaningful.filter((e) => e.clockOut);
  const displayEntries = primaryOpen
    ? filterMeaningfulAttendanceEntries([...completedEntries, primaryOpen])
    : completedEntries;

  const attendanceLive = await attendanceLiveSeconds(userId, dateStr, entries, now);
  const dayBreaks = await findBreaksOverlappingWindow(userId, start, end);

  const enrichedEntries = displayEntries.map((entry) => {
    let durationSeconds: number | null;
    if (entry.clockOut) {
      const entryBreaks = dayBreaks.filter(
        (b) =>
          b.startTime.getTime() < entry.clockOut!.getTime() &&
          ((b.endTime && b.endTime.getTime() > entry.clockIn.getTime()) || !b.endTime),
      );
      durationSeconds = resolveAttendanceDisplaySeconds(entry, entryBreaks, now);
    } else {
      durationSeconds = displayAttendanceDurationSeconds(
        entry,
        attendanceLive,
        primaryOpen?.id === entry.id,
      );
    }

    return {
      id: entry.id,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      durationSeconds,
      duration: durationSeconds != null ? Math.floor(durationSeconds / 60) : null,
      note: entry.note,
    };
  });

  const totalSeconds = enrichedEntries.reduce(
    (sum, entry) => sum + (entry.durationSeconds ?? 0),
    0,
  );
  const breakSeconds = sumBreakSecondsInWindow(dayBreaks, start, end, now);
  const sortedEntries = [...enrichedEntries].sort(
    (a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime(),
  );
  const stillOpen = sortedEntries.some((entry) => !entry.clockOut);
  const clockOut = stillOpen
    ? null
    : sortedEntries.reduce<Date | null>((latest, entry) => {
        if (!entry.clockOut) return latest;
        const ended = new Date(entry.clockOut);
        if (!latest || ended.getTime() > latest.getTime()) return ended;
        return latest;
      }, null);

  return {
    entries: enrichedEntries,
    clockIn: sortedEntries[0]?.clockIn ?? null,
    clockOut,
    totalMinutes: totalSeconds / 60,
    totalSeconds,
    totalHours: roundHours(totalSeconds / 3600),
    breakSeconds,
    breakMinutes: Math.floor(breakSeconds / 60),
    breakHours: roundHours(breakSeconds / 3600),
    entriesCount: enrichedEntries.length,
  };
}

export const timeEntryRouter = createRouter({
  clockIn: authedQuery
    .input(
      z
        .object({
          note: z.string().optional(),
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
          accuracyMeters: z.number().min(0).max(50_000).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPlanFeature(ctx.user, "time_tracking");
      await assertClockInWithinGeofence({
        user: ctx.user,
        latitude: input?.latitude,
        longitude: input?.longitude,
        accuracyMeters: input?.accuracyMeters,
      });

      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockClockIn(ctx.user.id, input?.note);
      }

      await ensureSchema();
      const now = new Date();

      await runAutoClockOutForUser(ctx.user.id, now);
      // Close any active session OR orphan open attendance rows before starting
      // a new one — otherwise concurrent/partial clock-outs leave duplicate day rows.
      if (await hasOpenAttendanceState(ctx.user.id)) {
        await clockOutAttendanceAtTime(ctx.user.id, now, "Clocked out for new session");
      }

      // Re-check after close to absorb a concurrent clock-in race.
      if (await hasOpenAttendanceState(ctx.user.id)) {
        await clockOutAttendanceAtTime(ctx.user.id, now, "Clocked out for new session");
      }

      const session = await insertDoc<WorkSessionDoc>(Collections.workSessions, {
        userId: ctx.user.id,
        startTime: now,
        endTime: null,
        active: true,
        paused: false,
        accumulatedWorkSeconds: 0,
        workSegmentStartedAt: now,
        breakStartedAt: null,
        createdAt: now,
      });

      const entry = await insertDoc<TimeEntryDoc>(Collections.timeEntries, {
        userId: ctx.user.id,
        organizationId: requireOrganizationId(ctx.user),
        taskId: null,
        projectId: null,
        clockIn: now,
        clockOut: null,
        duration: null,
        durationSeconds: null,
        note: input?.note || "Clocked in",
        source: "web",
        createdAt: now,
        updatedAt: now,
      });

      // If a concurrent clock-in also inserted an open row, keep the earliest and
      // remove the extras so only one live attendance entry remains.
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const openEntries = await timeCol
        .find({ userId: ctx.user.id, clockOut: null, taskId: null })
        .sort({ clockIn: 1, id: 1 })
        .toArray();
      if (openEntries.length > 1) {
        const keepId = openEntries[0].id;
        const duplicateIds = openEntries.filter((e) => e.id !== keepId).map((e) => e.id);
        await timeCol.deleteMany({ id: { $in: duplicateIds } });
        const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
        const activeSessions = await sessionCol
          .find({ userId: ctx.user.id, active: true })
          .sort({ startTime: 1, id: 1 })
          .toArray();
        if (activeSessions.length > 1) {
          const keepSessionId = activeSessions[0].id;
          await sessionCol.updateMany(
            { userId: ctx.user.id, active: true, id: { $ne: keepSessionId } },
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
        const keptEntry = openEntries[0];
        const keptSession =
          activeSessions.find((s) => s.id === activeSessions[0]?.id) ?? session;
        return {
          entry: keptEntry,
          session: await enrichSession(keptSession),
        };
      }

      return { entry, session: await enrichSession(session) };
    }),

  clockOut: authedQuery
    .input(
      z
        .object({
          note: z.string().optional(),
          clockIn: z.string().optional(),
          clockOut: z.string().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      await pauseAllRunningTaskTimersForUser(ctx.user.id, { actor: ctx.user });

      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockClockOut(ctx.user.id, input);
      }

      await ensureSchema();
      const now = new Date();
      const clockOutTime = input?.clockOut ? new Date(input.clockOut) : now;
      const clockInTime = input?.clockIn ? new Date(input.clockIn) : undefined;

      if (Number.isNaN(clockOutTime.getTime())) {
        throw new Error("Invalid clock out time");
      }
      if (clockInTime && Number.isNaN(clockInTime.getTime())) {
        throw new Error("Invalid clock in time");
      }
      if (clockOutTime.getTime() > now.getTime()) {
        throw new Error("Clock out time cannot be in the future");
      }

      const session = await findActiveSession(ctx.user.id);
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      // Prefer earliest open entry so the real shift is closed, not a short duplicate.
      const entry = await timeCol.findOne(
        { userId: ctx.user.id, clockOut: null, taskId: null },
        { sort: { clockIn: 1, id: 1 } },
      );

      const effectiveClockIn = clockInTime ?? entry?.clockIn ?? session?.startTime;
      if (!effectiveClockIn) {
        throw new Error("No active clock-in session found");
      }
      if (clockOutTime.getTime() <= effectiveClockIn.getTime()) {
        throw new Error("Clock out time must be after clock in time");
      }

      const result = await clockOutAttendanceAtTime(ctx.user.id, clockOutTime, {
        note: input?.note,
        clockIn: clockInTime,
        appendNote: Boolean(input?.note),
      });

      if (!result) {
        throw new Error("No active clock-in session found");
      }

      const closedEntry = result.entryId
        ? await timeCol.findOne({ id: result.entryId })
        : null;

      return {
        durationSeconds: result.durationSeconds,
        duration: Math.floor(result.durationSeconds / 60),
        entry: closedEntry,
      };
    }),

  getCurrentSession: authedQuery
    .query(async ({ ctx }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockCurrentSession(ctx.user.id);
      }

      await ensureSchema();
      await runAutoClockOutForUser(ctx.user.id);
      const session = await findActiveSession(ctx.user.id);
      if (!session) return null;
      const enriched = await enrichSession(session);
      const priorDayWorkSeconds = await completedAttendanceSecondsForDay(
        ctx.user.id,
        localDateKey(session.startTime),
      );
      return attachSessionApprovalInfo({ ...enriched, priorDayWorkSeconds });
    }),

  pauseSession: authedQuery
    .mutation(async ({ ctx }) => {
      await pauseAllRunningTaskTimersForUser(ctx.user.id, { actor: ctx.user });

      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockPauseWorkSession(ctx.user.id);
      }

      await ensureSchema();
      const session = await findActiveSession(ctx.user.id);
      if (!session) throw new Error("No active work session to pause");

      let workSegmentStartedAt = session.workSegmentStartedAt ?? session.startTime;
      if (session.paused || !workSegmentStartedAt) {
        throw new Error("No active work session to pause");
      }

      const accumulatedWorkSeconds =
        session.accumulatedWorkSeconds +
        Math.floor((Date.now() - workSegmentStartedAt.getTime()) / 1000);

      const breakStart = new Date();
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entry = await timeCol.findOne(
        { userId: ctx.user.id, clockOut: null, taskId: null },
        { sort: { clockIn: -1 } },
      );

      await openWorkBreak(
        ctx.user.id,
        session.id,
        entry?.id ?? null,
        breakStart,
      );

      const updated = await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
        accumulatedWorkSeconds,
        workSegmentStartedAt: null,
        breakStartedAt: breakStart,
        paused: true,
      });

      return await enrichSession(updated!);
    }),

  resumeSession: authedQuery
    .mutation(async ({ ctx }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockResumeWorkSession(ctx.user.id);
      }

      await ensureSchema();
      const session = await findActiveSession(ctx.user.id);
      if (!session) throw new Error("No active work session");
      if (!session.paused) throw new Error("Work session is not paused");

      const resumeTime = new Date();
      await closeOpenWorkBreak(session.id, resumeTime);

      const updated = await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
        workSegmentStartedAt: resumeTime,
        breakStartedAt: null,
        paused: false,
      });

      return await enrichSession(updated!);
    }),

  list: authedQuery
    .input(
      z.object({
        userId: z.number().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        page: z.number().default(1),
        limit: z.number().default(50),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { userId, startDate, endDate, page = 1, limit = 50 } = input || {};
      const canViewOthers = hasPermission(ctx.user, "time.view_team");
      const targetUserId = canViewOthers && userId ? userId : ctx.user.id;
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockTimeEntryList(targetUserId, { limit });
      }

      await ensureSchema();
      const skip = (page - 1) * limit;
      const filter: Record<string, unknown> = { userId: targetUserId };

      if (startDate || endDate) {
        const clockIn: Record<string, Date> = {};
        if (startDate && endDate && startDate === endDate) {
          const { start, end } = dayBounds(startDate);
          clockIn.$gte = start;
          clockIn.$lte = end;
        } else {
          if (startDate) clockIn.$gte = new Date(startDate);
          if (endDate) clockIn.$lte = new Date(endDate);
        }
        filter.clockIn = clockIn;
      }

      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const [entries, total] = await Promise.all([
        timeCol.find(filter).sort({ clockIn: -1 }).skip(skip).limit(limit).toArray(),
        countDocs(Collections.timeEntries, filter),
      ]);

      return { entries, total };
    }),

  getDayHours: authedQuery
    .input(
      z.object({
        date: z.string(),
        userId: z.number().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const canViewOthers = hasPermission(ctx.user, "time.view_team");
      const targetUserId = canViewOthers && input.userId ? input.userId : ctx.user.id;

      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockGetDayHours(targetUserId, input.date);
      }

      await ensureSchema();
      return buildDayHoursForUser(targetUserId, input.date);
    }),

  getBreaks: authedQuery
    .input(
      z.object({
        date: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        userId: z.number().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const canViewOthers = hasPermission(ctx.user, "time.view_team");
      const targetUserId = canViewOthers && input.userId ? input.userId : ctx.user.id;

      let windowStart: Date;
      let windowEnd: Date;
      if (input.from && input.to) {
        windowStart = new Date(input.from);
        windowEnd = new Date(input.to);
      } else {
        const dateStr = input.date ?? localDateKey(new Date());
        ({ start: windowStart, end: windowEnd } = dayBounds(dateStr));
      }

      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockGetBreaksForWindow(targetUserId, windowStart, windowEnd);
      }

      await ensureSchema();
      const breaks = await findBreaksOverlappingWindow(
        targetUserId,
        windowStart,
        windowEnd,
      );

      const approvalCol = await getCollection<TimeApprovalRequestDoc>(
        Collections.timeApprovalRequests,
      );
      const pendingBreakEdits = await approvalCol
        .find({
          userId: targetUserId,
          type: "break",
          status: "pending",
          workBreakId: { $in: breaks.map((b) => b.id) },
        })
        .toArray();
      const pendingByBreakId = new Map(
        pendingBreakEdits.map((r) => [
          r.workBreakId!,
          {
            id: r.id,
            requestedBreakStart: r.requestedBreakStart!,
            requestedBreakEnd: r.requestedBreakEnd,
            reason: r.reason,
          },
        ]),
      );

      return {
        breaks: breaks.map((b) => ({
          ...b,
          pendingEdit: pendingByBreakId.get(b.id) ?? null,
        })),
      };
    }),

  updateBreak: authedQuery
    .input(
      z.object({
        id: z.number(),
        startTime: z.string(),
        endTime: z.string().optional().nullable(),
        reason: z.string().min(1, "A reason is required to edit break times"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockUpdateBreak(ctx.user, input);
      }

      await ensureSchema();
      const breakCol = await getCollection<WorkBreakDoc>(Collections.workBreaks);
      const existing = await breakCol.findOne({ id: input.id });
      if (!existing) throw new Error("Break not found");
      if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new Error("Not allowed to edit this break");
      }

      const startTime = new Date(input.startTime);
      const endTime = input.endTime ? new Date(input.endTime) : null;
      if (endTime && endTime <= startTime) {
        throw new Error("Break end must be after break start");
      }
      if (endTime && endTime.getTime() > Date.now()) {
        throw new Error("Break end cannot be in the future");
      }

      const now = new Date();
      const wasOpen = !existing.endTime;
      const updated = await updateById<WorkBreakDoc>(Collections.workBreaks, input.id, {
        startTime,
        endTime,
        reason: input.reason.trim(),
        manuallyEdited: true,
        updatedAt: now,
      });

      // Keep the live session in sync when editing the current open break.
      const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
      const session = await sessionCol.findOne({
        id: existing.workSessionId,
        active: true,
      });
      if (session?.paused && session.breakStartedAt) {
        if (wasOpen && endTime) {
          await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
            workSegmentStartedAt: endTime,
            breakStartedAt: null,
            paused: false,
          });
        } else if (!endTime) {
          await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
            breakStartedAt: startTime,
          });
        }
      }

      // Drop any stale pending break-edit approval for this break.
      const approvalCol = await getCollection<TimeApprovalRequestDoc>(
        Collections.timeApprovalRequests,
      );
      await approvalCol.updateMany(
        {
          workBreakId: input.id,
          type: "break",
          status: "pending",
        },
        {
          $set: {
            status: "approved",
            reviewedBy: ctx.user.id,
            reviewedAt: now,
            reviewNote: "Applied directly by employee (approval no longer required)",
            updatedAt: now,
          },
        },
      );

      await refreshAttendanceEntriesOverlappingBreak(
        existing.userId,
        startTime,
        endTime ?? existing.endTime,
        now,
      );
      // Also refresh entries that overlapped the previous break window.
      if (
        existing.startTime.getTime() !== startTime.getTime() ||
        (existing.endTime?.getTime() ?? 0) !== (endTime?.getTime() ?? 0)
      ) {
        await refreshAttendanceEntriesOverlappingBreak(
          existing.userId,
          existing.startTime,
          existing.endTime,
          now,
        );
      }

      await resyncActiveSessionFromBreaks(existing.userId, now);

      return { ...updated!, requiresApproval: false };
    }),

  createBreak: authedQuery
    .input(
      z.object({
        userId: z.number().optional(),
        startTime: z.string(),
        endTime: z.string(),
        reason: z.string().min(1, "A reason is required to add a custom break"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockCreateBreak(ctx.user, input);
      }

      await ensureSchema();
      const targetUserId =
        input.userId && ctx.user.role === "admin" ? input.userId : ctx.user.id;
      if (input.userId && input.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new Error("Not allowed to add a break for this user");
      }

      const startTime = new Date(input.startTime);
      const endTime = new Date(input.endTime);
      if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        throw new Error("Invalid break times");
      }
      if (endTime <= startTime) {
        throw new Error("Break end must be after break start");
      }
      if (endTime.getTime() > Date.now()) {
        throw new Error("Break end cannot be in the future");
      }

      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const attendance = await timeCol.findOne(
        {
          userId: targetUserId,
          taskId: null,
          clockIn: { $lt: endTime },
          $or: [{ clockOut: null }, { clockOut: { $gt: startTime } }],
        },
        { sort: { clockIn: -1 } },
      );
      if (!attendance) {
        throw new Error(
          "No attendance entry covers this break time. You must have been clocked in.",
        );
      }

      const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
      const session = await sessionCol.findOne(
        {
          userId: targetUserId,
          startTime: { $lt: endTime },
          $or: [{ endTime: null }, { endTime: { $gt: startTime } }],
        },
        { sort: { startTime: -1 } },
      );
      if (!session) {
        throw new Error(
          "No work session found for that time. Clock in/out for the day must exist first.",
        );
      }

      const now = new Date();
      const created = await insertDoc<WorkBreakDoc>(Collections.workBreaks, {
        userId: targetUserId,
        workSessionId: session.id,
        timeEntryId: attendance.id,
        startTime,
        endTime,
        reason: input.reason.trim(),
        manuallyEdited: true,
        createdAt: now,
        updatedAt: now,
      });

      await refreshAttendanceEntriesOverlappingBreak(
        targetUserId,
        startTime,
        endTime,
        now,
      );
      await resyncActiveSessionFromBreaks(targetUserId, now);

      return { ...created, requiresApproval: false };
    }),

  updateAttendanceEntry: authedQuery
    .input(
      z.object({
        id: z.number(),
        clockIn: z.string(),
        clockOut: z.string(),
        breakMinutes: z.number().min(0).optional(),
        reason: z.string().min(1, "A reason is required to edit attendance times"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockUpdateAttendanceEntry(ctx.user, input);
      }

      await ensureSchema();
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const existing = await timeCol.findOne({ id: input.id, taskId: null });
      if (!existing) throw new Error("Attendance entry not found");
      if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new Error("Not allowed to edit this attendance entry");
      }
      if (!existing.clockOut) {
        throw new Error("Cannot edit an active session — clock out first");
      }

      const clockIn = new Date(input.clockIn);
      const clockOut = new Date(input.clockOut);
      if (Number.isNaN(clockIn.getTime()) || Number.isNaN(clockOut.getTime())) {
        throw new Error("Invalid clock in or clock out time");
      }
      if (clockOut <= clockIn) {
        throw new Error("Clock out must be after clock in");
      }
      if (clockOut.getTime() > Date.now()) {
        throw new Error("Clock out time cannot be in the future");
      }

      const now = new Date();
      let durationSeconds: number;
      if (input.breakMinutes != null) {
        const spanSeconds = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000);
        const breakSeconds = Math.min(input.breakMinutes * 60, spanSeconds);
        durationSeconds = Math.max(0, spanSeconds - breakSeconds);
      } else {
        durationSeconds = await computeStoredAttendanceDurationSeconds(
          existing.userId,
          clockIn,
          clockOut,
          now,
        );
      }
      const note = existing.note
        ? `${existing.note} — ${input.reason.trim()}`
        : input.reason.trim();

      const updated = await updateById<TimeEntryDoc>(Collections.timeEntries, input.id, {
        clockIn,
        clockOut,
        durationSeconds,
        duration: Math.floor(durationSeconds / 60),
        note,
        updatedAt: now,
      });

      const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
      const session = await sessionCol.findOne({
        userId: existing.userId,
        startTime: existing.clockIn,
      });
      if (session && !session.active) {
        await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
          startTime: clockIn,
          endTime: clockOut,
        });
      }

      return updated;
    }),

  requestManualClockIn: authedQuery
    .input(
      z.object({
        requestedClockIn: z.string(),
        reason: z.string().min(1, "A reason is required for manual clock-in"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockRequestManualClockIn(ctx.user, input);
      }

      await ensureSchema();
      const session = await findActiveSession(ctx.user.id);
      if (!session) throw new Error("You must be clocked in to request a manual clock-in time");

      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entry = await timeCol.findOne(
        { userId: ctx.user.id, clockOut: null, taskId: null },
        { sort: { clockIn: -1 } },
      );
      const actualClockIn = entry?.clockIn ?? session.startTime;
      const requestedClockIn = new Date(input.requestedClockIn);
      validateManualClockInRequest(requestedClockIn, actualClockIn);

      const existingRequest = await findClockInRequestForSession(session.id);
      if (existingRequest) {
        throw new Error("You have already submitted a manual clock-in request for this session");
      }

      const now = new Date();
      const request = await insertDoc<TimeApprovalRequestDoc>(
        Collections.timeApprovalRequests,
        {
          userId: ctx.user.id,
          organizationId: requireOrganizationId(ctx.user),
          type: "clock_in",
          status: "pending",
          reason: input.reason.trim(),
          workSessionId: session.id,
          timeEntryId: entry?.id ?? null,
          workBreakId: null,
          originalClockIn: actualClockIn,
          originalBreakStart: null,
          originalBreakEnd: null,
          requestedClockIn,
          requestedBreakStart: null,
          requestedBreakEnd: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          createdAt: now,
          updatedAt: now,
        },
      );

      const actorName = ctx.user.name || ctx.user.email || "An employee";
      const requestedLabel = formatWorkZoneTime(requestedClockIn, {
        hour: "numeric",
        minute: "2-digit",
      });
      const actualLabel = formatWorkZoneTime(actualClockIn, {
        hour: "numeric",
        minute: "2-digit",
      });

      await notifyAdmins({
        actor: ctx.user,
        type: "time_approval_pending",
        title: "Manual clock-in needs approval",
        message: `${actorName} requests clock-in at ${requestedLabel} instead of ${actualLabel}: ${input.reason.trim()}`,
        approvalRequestId: request.id,
        roles: ["admin", "hr"],
      });

      return { ...request, requiresApproval: true };
    }),

  listPendingApprovals: adminOrHrQuery.query(async ({ ctx }) => {
    if (isAuthDisabled() || !hasMongoConfigured()) {
      return mock.mockListPendingApprovals();
    }

    await ensureSchema();
    const approvalCol = await getCollection<TimeApprovalRequestDoc>(
      Collections.timeApprovalRequests,
    );
    const userCol = await getCollection<UserDoc>(Collections.users);
    const requests = await approvalCol
      .find({ status: "pending", ...orgFilter(ctx.user) })
      .sort({ createdAt: -1 })
      .toArray();

    const userIds = [...new Set(requests.map((r) => r.userId))];
    const users = userIds.length
      ? await userCol.find({ id: { $in: userIds }, ...orgFilter(ctx.user) }).toArray()
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      requests: requests.map((r) => ({
        ...r,
        user: userMap.get(r.userId) ?? null,
      })),
    };
  }),

  reviewTimeApproval: adminOrHrQuery
    .input(
      z.object({
        id: z.number(),
        action: z.enum(["approve", "reject"]),
        reviewNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockReviewTimeApproval(ctx.user, input);
      }

      await ensureSchema();
      const approvalCol = await getCollection<TimeApprovalRequestDoc>(
        Collections.timeApprovalRequests,
      );
      const request = await approvalCol.findOne({ id: input.id });
      if (!request) throw new Error("Approval request not found");
      if (request.status !== "pending") {
        throw new Error("This request has already been reviewed");
      }

      const now = new Date();
      const approved = input.action === "approve";
      const userCol = await getCollection<UserDoc>(Collections.users);
      const employee = await userCol.findOne({ id: request.userId });

      if (approved) {
        if (request.type === "clock_in") {
          const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
          const session = request.workSessionId
            ? await sessionCol.findOne({ id: request.workSessionId })
            : null;
          if (!session) throw new Error("Work session not found");

          const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
          const entry = request.timeEntryId
            ? await timeCol.findOne({ id: request.timeEntryId })
            : null;

          await applyClockInApproval(request, session, entry);
        } else if (request.type === "break") {
          const breakCol = await getCollection<WorkBreakDoc>(Collections.workBreaks);
          const breakItem = request.workBreakId
            ? await breakCol.findOne({ id: request.workBreakId })
            : null;
          if (!breakItem) throw new Error("Break not found");
          await applyBreakApproval(request, breakItem);
        }
      }

      await updateById<TimeApprovalRequestDoc>(Collections.timeApprovalRequests, request.id, {
        status: approved ? "approved" : "rejected",
        reviewedBy: ctx.user.id,
        reviewedAt: now,
        reviewNote: input.reviewNote?.trim() || null,
        updatedAt: now,
      });

      const employeeName = employee?.name || "Employee";
      const reviewMessage = approved
        ? `Your ${request.type === "clock_in" ? "manual clock-in" : "break edit"} request was approved.`
        : `Your ${request.type === "clock_in" ? "manual clock-in" : "break edit"} request was rejected.${input.reviewNote ? ` Note: ${input.reviewNote.trim()}` : ""}`;

      await notifyUserOfTimeReview(request.userId, ctx.user, approved, reviewMessage);

      return { success: true, approved, employeeName };
    }),

  getStats: authedQuery
    .input(z.object({ period: z.enum(["today", "week", "month"]).default("week") }))
    .query(async ({ ctx, input }) => {
      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockTimeStats(ctx.user.id, input.period);
      }

      await ensureSchema();
      const now = new Date();
      const { start: startDate, end: endDate } = periodClockInBounds(input.period, now);

      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entries = filterMeaningfulAttendanceEntries(
        await timeCol
          .find({
            userId: ctx.user.id,
            taskId: null,
            clockIn: { $gte: startDate, $lte: endDate },
            clockOut: { $ne: null },
          })
          .toArray(),
      );

      const dailyMapSeconds = new Map<string, number>();
      for (const e of entries) {
        const date = localDateKey(e.clockIn);
        const breaks = await findBreaksOverlappingWindow(
          ctx.user.id,
          e.clockIn,
          e.clockOut!,
        );
        const seconds = resolveAttendanceDisplaySeconds(e, breaks, now);
        dailyMapSeconds.set(date, (dailyMapSeconds.get(date) || 0) + seconds);
      }

      const session = await findActiveSession(ctx.user.id);
      let activeSession: { date: string; workSeconds: number } | null = null;

      if (session) {
        const sessionDate = localDateKey(session.startTime);
        const sessionInPeriod =
          session.startTime >= startDate && session.startTime <= endDate;

        if (sessionInPeriod) {
          const workSeconds = await liveSessionWorkSeconds(
            ctx.user.id,
            session.startTime,
            now,
          );
          dailyMapSeconds.set(
            sessionDate,
            (dailyMapSeconds.get(sessionDate) || 0) + workSeconds,
          );
          activeSession = { date: sessionDate, workSeconds };
        }
      }

      const totalSeconds = Array.from(dailyMapSeconds.values()).reduce(
        (sum, seconds) => sum + seconds,
        0,
      );
      const dailyMapMinutes = new Map(
        Array.from(dailyMapSeconds.entries()).map(([date, seconds]) => [
          date,
          seconds / 60,
        ]),
      );

      const rangeStartKey = localDateKey(startDate);
      const rangeEndKey = localDateKey(endDate);
      const leaveCol = await getCollection<LeaveRequestDoc>(Collections.leaveRequests);
      const approvedLeaves = await leaveCol
        .find({
          userId: ctx.user.id,
          status: "approved",
          startDate: { $lte: rangeEndKey },
          endDate: { $gte: rangeStartKey },
        })
        .toArray();
      const leaveByDate = buildLeaveCoverageMap(approvedLeaves);

      const summary = buildTimeStatsSummary(totalSeconds / 60, dailyMapMinutes, input.period, {
        leaveByDate,
        referenceDate: now,
      });

      return {
        ...summary,
        totalSeconds,
        entriesCount: entries.length,
        activeSession,
      };
    }),

  getMonthAttendance: authedQuery
    .input(
      z
        .object({
          year: z.number().int().min(2000).max(2100).optional(),
          month: z.number().int().min(1).max(12).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { year, month } = resolveMonthInput(input);
      await ensureSchema();
      return computeUserMonthAttendance(ctx.user.id, year, month);
    }),

  getTeamMonthAttendance: authedQuery
    .input(
      z
        .object({
          year: z.number().int().min(2000).max(2100).optional(),
          month: z.number().int().min(1).max(12).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      assertLeaveManager(ctx.user);
      const { year, month } = resolveMonthInput(input);
      await ensureSchema();
      return computeTeamMonthAttendance(
        year,
        month,
        new Date(),
        ctx.user.organizationId,
      );
    }),

  getTeamHours: authedQuery
    .input(z.object({
      date: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      assertPermission(ctx.user, "time.view_team");

      if (isAuthDisabled() || !hasMongoConfigured()) {
        return mock.mockTeamHours(input ?? undefined);
      }

      await ensureSchema();

      let dateStr: string;
      if (input?.date) {
        dateStr = input.date;
      } else {
        dateStr = localDateKey(new Date());
      }

      const userCol = await getCollection<UserDoc>(Collections.users);
      const allUsers = (
        await userCol
          .find({ status: "active", ...orgFilter(ctx.user) })
          .project({ id: 1, name: 1, avatar: 1, role: 1, department: 1 })
          .toArray()
      ).filter((user) => isAttendanceTrackableUser(user));

      const now = new Date();
      const teamHours = await Promise.all(
        allUsers.map(async (user) => {
          const day = await buildDayHoursForUser(user.id, dateStr, now);
          return {
            userId: user.id,
            name: user.name || "Unknown",
            avatar: user.avatar,
            role: user.role,
            totalHours: day.totalHours,
            breakHours: day.breakHours,
            breakSeconds: day.breakSeconds,
            entriesCount: day.entriesCount,
            clockIn: day.clockIn,
            clockOut: day.clockOut,
          };
        }),
      );

      return teamHours;
    }),

  createManual: managerQuery
    .input(z.object({
      userId: z.number(),
      clockIn: z.string(),
      clockOut: z.string(),
      note: z.string().optional(),
      taskId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await ensureSchema();
      const clockIn = new Date(input.clockIn);
      const clockOut = new Date(input.clockOut);
      const durationSeconds = Math.max(
        0,
        Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000),
      );
      const duration = Math.floor(durationSeconds / 60);
      const now = new Date();

      return insertDoc<TimeEntryDoc>(Collections.timeEntries, {
        userId: input.userId,
        organizationId: requireOrganizationId(ctx.user),
        taskId: input.taskId ?? null,
        projectId: null,
        clockIn,
        clockOut,
        duration,
        durationSeconds,
        note: input.note || "Manual entry",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      });
    }),

  delete: managerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ensureSchema();
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      await timeCol.deleteOne({ id: input.id });
      return { success: true };
    }),
});
