import { Collections } from "@db/mongo/collections";
import type {
  NotificationDoc,
  SafeUser,
  TimeApprovalRequestDoc,
  TimeEntryDoc,
  WorkBreakDoc,
  WorkSessionDoc,
} from "@db/mongo/types";
import { getCollection, insertDoc, updateById } from "../queries/connection";
import {
  computeAttendanceWorkSeconds,
  localDateKey,
} from "@/lib/work-hours-policy";
import { formatWorkZoneDateTime } from "@/lib/timezone";
import {
  findBreaksOverlappingWindow,
  refreshAttendanceEntriesOverlappingBreak,
} from "./attendance-breaks";

export async function findClockInRequestForSession(workSessionId: number) {
  const col = await getCollection<TimeApprovalRequestDoc>(Collections.timeApprovalRequests);
  return col.findOne({
    workSessionId,
    type: "clock_in",
  });
}

/** @deprecated Use findClockInRequestForSession — kept for callers that only need pending. */
export async function findPendingClockInRequest(workSessionId: number) {
  const col = await getCollection<TimeApprovalRequestDoc>(Collections.timeApprovalRequests);
  return col.findOne({
    workSessionId,
    type: "clock_in",
    status: "pending",
  });
}

export async function applyClockInApproval(
  request: TimeApprovalRequestDoc,
  session: WorkSessionDoc,
  entry: TimeEntryDoc | null,
) {
  if (!request.requestedClockIn || !request.originalClockIn) {
    throw new Error("Invalid clock-in approval request");
  }

  const deltaSeconds = Math.floor(
    (request.originalClockIn.getTime() - request.requestedClockIn.getTime()) / 1000,
  );
  if (deltaSeconds <= 0) {
    throw new Error("Approved clock-in must be earlier than the actual clock-in");
  }

  const now = new Date();
  const requestedClockIn = request.requestedClockIn;
  const breaks = await findBreaksOverlappingWindow(
    session.userId,
    requestedClockIn,
    session.endTime ?? now,
  );

  const sessionPatch: Partial<WorkSessionDoc> = {
    startTime: requestedClockIn,
  };

  if (session.active) {
    // Recalculate worked seconds from the approved start, excluding breaks —
    // never add raw wall-clock delta (that over-counts paused time).
    if (session.paused) {
      const pauseAt = session.breakStartedAt ?? now;
      sessionPatch.accumulatedWorkSeconds = computeAttendanceWorkSeconds(
        requestedClockIn,
        pauseAt,
        breaks,
        now,
      );
      sessionPatch.workSegmentStartedAt = null;
    } else {
      const segmentStart = session.workSegmentStartedAt;
      const segmentIsOriginalClockIn =
        !!segmentStart &&
        Math.abs(segmentStart.getTime() - request.originalClockIn.getTime()) < 2000;

      if (!segmentStart || segmentIsOriginalClockIn) {
        // Freeze work so far (break-aware) then continue from now.
        sessionPatch.accumulatedWorkSeconds = computeAttendanceWorkSeconds(
          requestedClockIn,
          now,
          breaks,
          now,
        );
        sessionPatch.workSegmentStartedAt = now;
      } else {
        sessionPatch.accumulatedWorkSeconds = computeAttendanceWorkSeconds(
          requestedClockIn,
          segmentStart,
          breaks,
          now,
        );
        // Keep current work segment start (e.g. after a resume).
      }
    }
  }

  await updateById<WorkSessionDoc>(Collections.workSessions, session.id, sessionPatch);

  if (entry) {
    const entryPatch: Partial<TimeEntryDoc> = {
      clockIn: requestedClockIn,
      note: entry.note
        ? `${entry.note} (clock-in adjusted to ${formatWorkZoneDateTime(requestedClockIn)})`
        : `Clock-in adjusted to ${formatWorkZoneDateTime(requestedClockIn)}`,
      updatedAt: now,
    };

    if (entry.clockOut) {
      const durationSeconds = computeAttendanceWorkSeconds(
        requestedClockIn,
        entry.clockOut,
        breaks,
        now,
      );
      entryPatch.durationSeconds = durationSeconds;
      entryPatch.duration = Math.floor(durationSeconds / 60);
    }

    await updateById<TimeEntryDoc>(Collections.timeEntries, entry.id, entryPatch);
  }
}

export async function applyBreakApproval(
  request: TimeApprovalRequestDoc,
  breakItem: WorkBreakDoc,
) {
  if (!request.requestedBreakStart) {
    throw new Error("Invalid break approval request");
  }

  const startTime = request.requestedBreakStart;
  const endTime = request.requestedBreakEnd;
  if (endTime && endTime <= startTime) {
    throw new Error("Break end must be after break start");
  }

  const now = new Date();
  await updateById<WorkBreakDoc>(Collections.workBreaks, breakItem.id, {
    startTime,
    endTime,
    reason: request.reason.trim(),
    manuallyEdited: true,
    updatedAt: now,
  });

  await refreshAttendanceEntriesOverlappingBreak(
    breakItem.userId,
    startTime,
    endTime ?? breakItem.endTime,
    now,
  );

  const sessionCol = await getCollection<WorkSessionDoc>(Collections.workSessions);
  const session = await sessionCol.findOne({
    id: breakItem.workSessionId,
    active: true,
  });

  if (session?.paused && session.breakStartedAt && !breakItem.endTime) {
    await updateById<WorkSessionDoc>(Collections.workSessions, session.id, {
      breakStartedAt: startTime,
    });
  }
}

export async function notifyUserOfTimeReview(
  userId: number,
  actor: SafeUser,
  approved: boolean,
  message: string,
) {
  const now = new Date();
  await insertDoc<NotificationDoc>(Collections.notifications, {
    userId,
    organizationId: actor.organizationId,
    actorId: actor.id,
    type: approved ? "time_approved" : "time_rejected",
    title: approved ? "Time adjustment approved" : "Time adjustment rejected",
    message,
    taskId: null,
    read: false,
    createdAt: now,
  });
}

export function validateManualClockInRequest(
  requestedClockIn: Date,
  actualClockIn: Date,
) {
  if (requestedClockIn >= actualClockIn) {
    throw new Error("Manual clock-in time must be earlier than your actual clock-in time");
  }
  if (localDateKey(requestedClockIn) !== localDateKey(actualClockIn)) {
    throw new Error("Manual clock-in must be on the same day as your session");
  }
  if (requestedClockIn.getTime() > Date.now()) {
    throw new Error("Manual clock-in cannot be in the future");
  }
}
