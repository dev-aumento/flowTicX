import { Collections } from "@db/mongo/collections";
import type { TimeEntryDoc, WorkBreakDoc, WorkSessionDoc } from "@db/mongo/types";
import {
  computeAttendanceWorkSeconds,
  resolveAttendanceDisplaySeconds,
  filterMeaningfulAttendanceEntries,
} from "@/lib/work-hours-policy";
import { getCollection, hasMongoConfigured, updateById } from "../queries/connection";
import { isAuthDisabled } from "./dev-mode";
import * as mock from "./mock-store";

export async function findBreaksOverlappingWindow(
  userId: number,
  windowStart: Date,
  windowEnd: Date,
): Promise<WorkBreakDoc[]> {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    return mock.mockFindBreaksOverlappingWindow(userId, windowStart, windowEnd);
  }

  const breakCol = await getCollection<WorkBreakDoc>(Collections.workBreaks);
  return breakCol
    .find({
      userId,
      startTime: { $lt: windowEnd },
      $or: [{ endTime: { $gt: windowStart } }, { endTime: null }],
    })
    .sort({ startTime: 1 })
    .toArray();
}

export async function computeStoredAttendanceDurationSeconds(
  userId: number,
  clockIn: Date,
  clockOut: Date,
  now = new Date(),
) {
  const breaks = await findBreaksOverlappingWindow(userId, clockIn, clockOut);
  return computeAttendanceWorkSeconds(clockIn, clockOut, breaks, now);
}

/** Recompute and persist durationSeconds for a completed attendance entry. */
export async function refreshAttendanceEntryDuration(
  entry: TimeEntryDoc,
  now = new Date(),
) {
  if (!entry.clockOut || entry.taskId != null) return entry;

  const durationSeconds = await computeStoredAttendanceDurationSeconds(
    entry.userId,
    entry.clockIn,
    entry.clockOut,
    now,
  );

  const updated = await updateById<TimeEntryDoc>(Collections.timeEntries, entry.id, {
    durationSeconds,
    duration: Math.floor(durationSeconds / 60),
    updatedAt: now,
  });
  return updated ?? entry;
}

/**
 * After a break is created/edited, refresh every completed attendance entry
 * that overlaps that break window so day totals stay correct.
 */
export async function refreshAttendanceEntriesOverlappingBreak(
  userId: number,
  breakStart: Date,
  breakEnd: Date | null | undefined,
  now = new Date(),
) {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    mock.mockRefreshAttendanceEntriesOverlappingBreak(
      userId,
      breakStart,
      breakEnd ?? now,
      now,
    );
    return;
  }

  const end = breakEnd ?? now;
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const overlapping = await timeCol
    .find({
      userId,
      taskId: null,
      clockOut: { $ne: null, $gt: breakStart },
      clockIn: { $lt: end },
    })
    .toArray();

  await Promise.all(
    overlapping.map((entry) => refreshAttendanceEntryDuration(entry, now)),
  );
}

/**
 * After break create/edit, rebuild live session accumulation from clock-in → now
 * minus all breaks so today's timer matches the break table.
 */
export async function resyncActiveSessionFromBreaks(
  userId: number,
  now = new Date(),
) {
  if (isAuthDisabled() || !hasMongoConfigured()) {
    mock.mockResyncActiveSessionFromBreaks(userId, now);
    return;
  }

  const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
  const session = await sessionCol.findOne({ userId, active: true });
  if (!session) return;

  const workSeconds = await computeStoredAttendanceDurationSeconds(
    userId,
    session.startTime,
    now,
    now,
  );

  if (session.paused) {
    await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
      accumulatedWorkSeconds: workSeconds,
      workSegmentStartedAt: null,
    });
    return;
  }

  await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
    accumulatedWorkSeconds: workSeconds,
    workSegmentStartedAt: now,
  });
}

export async function sumCompletedAttendanceSecondsForEntries(
  userId: number,
  entries: TimeEntryDoc[],
  now = new Date(),
) {
  const meaningful = filterMeaningfulAttendanceEntries(
    entries.filter((e) => e.clockOut && e.taskId == null),
  );
  let total = 0;
  for (const entry of meaningful) {
    if (!entry.clockOut) continue;
    const breaks = await findBreaksOverlappingWindow(
      userId,
      entry.clockIn,
      entry.clockOut,
    );
    total += resolveAttendanceDisplaySeconds(entry, breaks, now);
  }
  return total;
}
