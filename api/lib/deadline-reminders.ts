import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, TaskDoc } from "@db/mongo/types";
import { formatDueLabel } from "@/lib/task-deadline";
import { startOfWorkZoneDay, workZoneDateParts, workZoneWallTimeToUtc } from "@/lib/timezone";
import { getCollection, hasMongoConfigured } from "../queries/connection";
import { ensureSchema } from "./migrate";
import { isAuthDisabled } from "./dev-mode";
import { notifyTaskStakeholders } from "./notify-task-members";

/** How often to scan for tasks whose due date has been reached. */
const DEADLINE_REMINDER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

function endOfWorkZoneDayFrom(now: Date) {
  const { year, month, day } = workZoneDateParts(now);
  return workZoneWallTimeToUtc(year, month, day, 23, 59, 59, 999);
}

/**
 * Notify assignee, participants, and observers when a task due date is
 * reached or overdue. Does not modify assignee, status, or timers.
 *
 * Sends at most one "deadline reached" reminder per task per work-zone day.
 */
export async function runDeadlineReminderJob(now = new Date()) {
  if (useMock()) return { sent: 0, tasks: 0 };

  await ensureSchema();

  const taskCol = await getCollection<TaskDoc>(Collections.tasks);
  const notifCol = await getCollection<NotificationDoc>(Collections.notifications);

  const dueTasks = await taskCol
    .find({
      status: { $ne: "done" },
      dueDate: { $ne: null, $lte: now },
    })
    .project({
      id: 1,
      title: 1,
      dueDate: 1,
      assigneeId: 1,
      organizationId: 1,
    })
    .toArray();

  if (dueTasks.length === 0) return { sent: 0, tasks: 0 };

  const dayStart = startOfWorkZoneDay(now);
  const dayEnd = endOfWorkZoneDayFrom(now);
  let sent = 0;

  for (const task of dueTasks) {
    if (!task.dueDate) continue;

    const alreadySentToday = await notifCol.findOne({
      taskId: task.id,
      type: "deadline_reminder",
      title: "Task deadline reached",
      createdAt: { $gte: dayStart, $lte: dayEnd },
    });
    if (alreadySentToday) continue;

    const dueLabel = formatDueLabel(task.dueDate);
    const beforeCount = await notifCol.countDocuments({
      taskId: task.id,
      type: "deadline_reminder",
      title: "Task deadline reached",
      createdAt: { $gte: dayStart },
    });

    await notifyTaskStakeholders({
      taskId: task.id,
      actor: null,
      type: "deadline_reminder",
      title: "Task deadline reached",
      message: `"${task.title}" deadline has been reached (${dueLabel}).`,
      organizationId: task.organizationId ?? null,
    });

    const afterCount = await notifCol.countDocuments({
      taskId: task.id,
      type: "deadline_reminder",
      title: "Task deadline reached",
      createdAt: { $gte: dayStart },
    });
    sent += Math.max(0, afterCount - beforeCount);
  }

  return { sent, tasks: dueTasks.length };
}

let schedulerStarted = false;

export function startDeadlineReminderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    void runDeadlineReminderJob().catch((error) => {
      console.error("[deadline-reminder] job failed:", error);
    });
  };

  setTimeout(tick, 20_000);
  setInterval(tick, DEADLINE_REMINDER_INTERVAL_MS);
}
