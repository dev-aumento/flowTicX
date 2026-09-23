import { Collections } from "@db/mongo/collections";
import type { SafeUser, TaskActivityDoc, TaskDoc, TimeEntryDoc } from "@db/mongo/types";
import {
  getCollection,
  hasMongoConfigured,
  insertDoc,
  findById,
  updateById,
} from "../queries/connection";
import { findUserById, omitPasswordHash } from "../queries/users";
import { notifyTaskMembers } from "./notify-task-members";
import { isAuthDisabled } from "./dev-mode";
import * as mock from "./mock-store";

function actorLabel(user: SafeUser) {
  return user.name || user.email || "Someone";
}

function usesMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

async function resolveActor(userId: number, actor?: SafeUser): Promise<SafeUser | null> {
  if (actor) return actor;
  const user = await findUserById(userId);
  return user ? omitPasswordHash(user) : null;
}

export async function pauseRunningTaskTimerEntry(
  user: SafeUser,
  taskId: number,
  entry: TimeEntryDoc,
  now: Date,
  note = "Task timer (paused)",
) {
  const durationSeconds = Math.max(
    0,
    Math.floor((now.getTime() - entry.clockIn.getTime()) / 1000),
  );
  const duration = Math.floor(durationSeconds / 60);
  await updateById<TimeEntryDoc>(Collections.timeEntries, entry.id, {
    clockOut: now,
    duration,
    durationSeconds,
    note,
    updatedAt: now,
  });

  const task = await findById<TaskDoc>(Collections.tasks, taskId);
  await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
    taskId,
    userId: user.id,
    action: "time_logged",
    oldValue: null,
    newValue: duration > 0 ? `paused timer ${duration} minutes` : "paused timer",
    metadata: null,
    createdAt: now,
  });

  if (task) {
    void notifyTaskMembers({
      taskId,
      actor: user,
      type: "task_updated",
      title: "Timer paused",
      message: `${actorLabel(user)} paused the timer on "${task.title}"`,
    }).catch(() => undefined);
  }

  return { taskId, durationSeconds };
}

/** Pause every running task timer for a user (e.g. on clock out or break). */
export async function pauseAllRunningTaskTimersForUser(
  userId: number,
  options?: { now?: Date; note?: string; actor?: SafeUser },
): Promise<Array<{ taskId: number; durationSeconds: number }>> {
  if (usesMock()) {
    const actor = await resolveActor(userId, options?.actor);
    if (!actor) return [];
    return mock.mockPauseAllRunningTaskTimers(userId, actor);
  }

  const actor = await resolveActor(userId, options?.actor);
  if (!actor) return [];

  const now = options?.now ?? new Date();
  const note = options?.note ?? "Task timer (paused)";
  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const openEntries = await timeCol
    .find({
      userId,
      taskId: { $ne: null },
      clockOut: null,
    })
    .toArray();

  const results: Array<{ taskId: number; durationSeconds: number }> = [];
  for (const entry of openEntries) {
    if (entry.taskId == null) continue;
    const result = await pauseRunningTaskTimerEntry(
      actor,
      entry.taskId,
      entry,
      now,
      note,
    );
    results.push(result);
  }
  return results;
}

export async function pauseOtherRunningTaskTimers(
  user: SafeUser,
  exceptTaskId: number,
  now = new Date(),
) {
  if (usesMock()) {
    const active = mock.mockGetMyActiveTaskTimer(user.id);
    if (active && active.taskId !== exceptTaskId && active.startedAt && !active.paused) {
      mock.mockPauseTaskTimer(user.id, active.taskId, user);
    }
    return;
  }

  const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const openEntries = await timeCol
    .find({
      userId: user.id,
      taskId: { $ne: exceptTaskId, $type: "number" },
      clockOut: null,
    })
    .toArray();

  for (const entry of openEntries) {
    if (entry.taskId == null) continue;
    await pauseRunningTaskTimerEntry(user, entry.taskId, entry, now);
  }
}
