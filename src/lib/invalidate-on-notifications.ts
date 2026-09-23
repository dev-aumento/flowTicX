import type { StreamNotification } from "@/lib/notification-stream-client";
import type { trpc } from "@/providers/trpc";
import { refreshDashboardStats } from "@/lib/dashboard-refresh";

type TrpcUtils = ReturnType<typeof trpc.useUtils>;

const TASK_LIST_NOTIFICATION_TYPES = new Set([
  "task_assigned",
  "task_created",
  "task_updated",
  "mention",
  "deadline_reminder",
]);

const LEAVE_NOTIFICATION_TYPES = new Set([
  "leave_request_pending",
  "leave_approved",
  "leave_rejected",
  "leave_cancelled",
  "holiday_reminder",
]);

const TIME_NOTIFICATION_TYPES = new Set([
  "time_approval_pending",
  "time_approved",
  "time_rejected",
]);

export function notificationsAffectTaskQueries(notifications: StreamNotification[]) {
  return notifications.some(
    (n) =>
      n.taskId != null &&
      (n.type == null || TASK_LIST_NOTIFICATION_TYPES.has(n.type)),
  );
}

export function notificationsAffectLeaveQueries(notifications: StreamNotification[]) {
  return notifications.some(
    (n) => n.type != null && LEAVE_NOTIFICATION_TYPES.has(n.type),
  );
}

export function notificationsAffectTimeQueries(notifications: StreamNotification[]) {
  return notifications.some(
    (n) => n.type != null && TIME_NOTIFICATION_TYPES.has(n.type),
  );
}

export function taskIdsFromNotifications(notifications: StreamNotification[]) {
  return [
    ...new Set(
      notifications
        .filter((n) => n.taskId != null)
        .map((n) => n.taskId as number),
    ),
  ];
}

export async function invalidateTaskQueries(
  utils: TrpcUtils,
  options?: { taskIds?: number[] },
) {
  const taskIds = options?.taskIds ?? [];

  await Promise.all([
    utils.task.list.invalidate(undefined, { refetchType: "active" }),
    refreshDashboardStats(utils),
    taskIds.length > 0
      ? Promise.all(taskIds.map((taskId) => utils.task.getById.invalidate({ id: taskId })))
      : utils.task.getById.invalidate(),
  ]);
}

export async function invalidateLeaveQueries(utils: TrpcUtils) {
  await Promise.all([
    utils.leave.myBalance.invalidate(),
    utils.leave.myRequests.invalidate(),
    utils.leave.listPending.invalidate(),
    // Approved leave changes daily/weekly required work hours.
    utils.timeEntry.getStats.invalidate(),
  ]);
}

export async function invalidateTimeQueries(utils: TrpcUtils) {
  await Promise.all([
    utils.timeEntry.getCurrentSession.invalidate(),
    utils.timeEntry.getStats.invalidate(),
    utils.timeEntry.getDayHours.invalidate(),
    utils.timeEntry.getBreaks.invalidate(),
    utils.timeEntry.list.invalidate(),
    utils.timeEntry.listPendingApprovals.invalidate(),
    utils.timeEntry.getTeamHours.invalidate(),
    refreshDashboardStats(utils),
  ]);
}

export function invalidateQueriesForNotifications(
  utils: TrpcUtils,
  notifications: StreamNotification[],
) {
  if (notifications.length === 0) return;

  void utils.notification.list.invalidate();

  if (notificationsAffectLeaveQueries(notifications)) {
    void invalidateLeaveQueries(utils);
  }

  if (notificationsAffectTimeQueries(notifications)) {
    void invalidateTimeQueries(utils);
  }

  if (notificationsAffectTaskQueries(notifications)) {
    void invalidateTaskQueries(utils, {
      taskIds: taskIdsFromNotifications(notifications),
    });
  }

  if (notifications.some((n) => String(n.type ?? "").startsWith("plan_"))) {
    void utils.subscription.current.invalidate();
    void utils.platform.listClients.invalidate();
    void utils.platform.overview.invalidate();
    void utils.auth.me.invalidate();
  }

  if (
    notifications.some(
      (n) =>
        n.type === "invoice_created" ||
        n.type === "invoice_updated" ||
        n.invoiceId != null,
    )
  ) {
    void utils.invoice.list.invalidate(undefined, { refetchType: "all" });
    void utils.invoice.get.invalidate();
    void refreshDashboardStats(utils);
  }
}
