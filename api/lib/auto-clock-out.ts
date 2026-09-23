import { Collections } from "@db/mongo/collections";
import type { TimeEntryDoc, WorkSessionDoc } from "@db/mongo/types";
import {
  getAutoClockOutDeadline,
  isPastAutoClockOutDeadline,
} from "@/lib/work-hours-policy";
import { getCollection, updateById, hasMongoConfigured } from "../queries/connection";
import { ensureSchema } from "./migrate";
import { isAuthDisabled } from "./dev-mode";
import { closeOpenBreaksForSession } from "./work-breaks";
import { computeStoredAttendanceDurationSeconds } from "./attendance-breaks";
import { pauseAllRunningTaskTimersForUser } from "./task-timers";
import * as mock from "./mock-store";

export const AUTO_CLOCK_OUT_NOTE = "Auto clock-out at 12:00 AM";

async function findActiveSession(userId: number) {
  const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
  return sessionCol.findOne({ userId, active: true }, { sort: { startTime: 1 } });
}

async function deactivateOtherActiveSessions(
  userId: number,
  keepSessionId: number | null,
  endTime: Date,
) {
  const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
  const filter: Record<string, unknown> = { userId, active: true };
  if (keepSessionId != null) filter.id = { $ne: keepSessionId };
  await sessionCol.updateMany(filter, {
    $set: {
      active: false,
      endTime,
      paused: false,
      accumulatedWorkSeconds: 0,
      workSegmentStartedAt: null,
      breakStartedAt: null,
    },
  });
}

async function deleteDuplicateOpenAttendance(
  duplicates: TimeEntryDoc[],
) {
  if (duplicates.length === 0) return;
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  await timeCol.deleteMany({ id: { $in: duplicates.map((d) => d.id) } });
}

export type CloseAttendanceOptions = {
  note?: string;
  /** Optional override for the primary entry's clock-in time. */
  clockIn?: Date;
  /** When true, append note to existing note (auto / forced close). Default true. */
  appendNote?: boolean;
};

/**
 * Close the earliest open attendance entry (and its session), and remove any
 * leftover duplicate open attendance rows so they cannot inflate day totals.
 */
export async function clockOutAttendanceAtTime(
  userId: number,
  clockOutTime: Date,
  noteOrOptions: string | CloseAttendanceOptions = AUTO_CLOCK_OUT_NOTE,
) {
  const options: CloseAttendanceOptions =
    typeof noteOrOptions === "string"
      ? { note: noteOrOptions, appendNote: true }
      : noteOrOptions;
  const appendNote = options.appendNote !== false;
  // Only fall back to the auto-clock-out note when the caller did not pass options
  // (string form) or explicitly omitted note while appending is expected.
  const note =
    typeof noteOrOptions === "string"
      ? noteOrOptions
      : options.note;

  const session = await findActiveSession(userId);

  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const openEntries = await timeCol
    .find({ userId, clockOut: null, taskId: null })
    .sort({ clockIn: 1, id: 1 })
    .toArray();
  const entry = openEntries[0] ?? null;

  const effectiveClockIn = options.clockIn ?? entry?.clockIn ?? session?.startTime;
  if (!effectiveClockIn) return null;
  if (clockOutTime.getTime() <= effectiveClockIn.getTime()) return null;

  await pauseAllRunningTaskTimersForUser(userId, { now: clockOutTime });

  let durationSeconds = 0;
  const now = new Date();

  if (session) {
    if (session.paused) {
      await closeOpenBreaksForSession(session.id, clockOutTime);
    }
    durationSeconds = await computeStoredAttendanceDurationSeconds(
      userId,
      effectiveClockIn,
      clockOutTime,
      now,
    );
    await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
      active: false,
      endTime: clockOutTime,
      paused: false,
      accumulatedWorkSeconds: 0,
      workSegmentStartedAt: null,
      breakStartedAt: null,
      ...(options.clockIn ? { startTime: options.clockIn } : {}),
    });
  } else if (entry) {
    durationSeconds = await computeStoredAttendanceDurationSeconds(
      userId,
      effectiveClockIn,
      clockOutTime,
      now,
    );
  }

  // Clear any leftover duplicate active sessions for this user.
  await deactivateOtherActiveSessions(userId, null, clockOutTime);

  if (entry) {
    let mergedNote = entry.note;
    if (note) {
      mergedNote = appendNote
        ? entry.note
          ? `${entry.note} - ${note}`
          : note
        : note;
    }
    await updateById<TimeEntryDoc>(Collections.timeEntries, entry.id, {
      ...(options.clockIn ? { clockIn: options.clockIn } : {}),
      clockOut: clockOutTime,
      durationSeconds,
      duration: Math.floor(durationSeconds / 60),
      note: mergedNote,
      updatedAt: now,
    });
  }

  // Remove leftover duplicate open attendance rows entirely (do not leave
  // zero-duration "Clocked in" fragments that inflate weekly totals).
  const duplicateOpen = openEntries.filter((e) => e.id !== entry?.id);
  await deleteDuplicateOpenAttendance(duplicateOpen);

  return {
    userId,
    clockOutTime,
    durationSeconds,
    entryId: entry?.id ?? null,
  };
}

/**
 * True when the user still has an active session or any open attendance row.
 * Used before clock-in so orphan open entries cannot stack beside a new session.
 */
export async function hasOpenAttendanceState(userId: number): Promise<boolean> {
  const session = await findActiveSession(userId);
  if (session) return true;
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const open = await timeCol.findOne({ userId, clockOut: null, taskId: null });
  return open != null;
}

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

export async function runAutoClockOutForUser(userId: number, now = new Date()) {
  if (useMock()) {
    return mock.mockRunAutoClockOutForUser(userId, now);
  }

  await ensureSchema();
  const session = await findActiveSession(userId);
  if (!session || !isPastAutoClockOutDeadline(session.startTime, now)) {
    return null;
  }

  const deadline = getAutoClockOutDeadline(session.startTime);
  return clockOutAttendanceAtTime(userId, deadline);
}

export async function runAutoClockOutJob(now = new Date()) {
  if (useMock()) {
    return mock.mockRunAutoClockOutJob(now);
  }

  await ensureSchema();
  const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
  const activeSessions = await sessionCol.find({ active: true }).toArray();

  const results = [];
  for (const session of activeSessions) {
    if (!isPastAutoClockOutDeadline(session.startTime, now)) continue;
    const deadline = getAutoClockOutDeadline(session.startTime);
    const result = await clockOutAttendanceAtTime(session.userId, deadline);
    if (result) results.push(result);
  }
  return results;
}

const AUTO_CLOCK_OUT_INTERVAL_MS = 60_000;
let schedulerStarted = false;

export function startAutoClockOutScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    void runAutoClockOutJob().catch((error) => {
      console.error("[auto-clock-out] job failed:", error);
    });
  };

  tick();
  setInterval(tick, AUTO_CLOCK_OUT_INTERVAL_MS);
}
