import type { trpc } from "@/providers/trpc";

type TrpcUtils = ReturnType<typeof trpc.useUtils>;

export const NOTIFICATION_LIST_ALL = { unreadOnly: false, limit: 50 } as const;
export const NOTIFICATION_LIST_UNREAD = { unreadOnly: true, limit: 50 } as const;

type NotificationListData = {
  notifications: Array<{ id: number; read: boolean | null }>;
  unreadCount: number;
};

/** Mark one notification read in React Query caches without removing it from the full list. */
export function markNotificationReadInCache(utils: TrpcUtils, id: number) {
  utils.notification.list.setData(NOTIFICATION_LIST_ALL, (old) => {
    if (!old) return old;
    const notifications = old.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    );
    return {
      ...old,
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
    };
  });

  utils.notification.list.setData(NOTIFICATION_LIST_UNREAD, (old) => {
    if (!old) return old;
    const notifications = old.notifications.filter((n) => n.id !== id);
    return {
      ...old,
      notifications,
      unreadCount: Math.max(0, old.unreadCount - 1),
    };
  });

  utils.notification.list.setData({ limit: 100, unreadOnly: false }, (old) => {
    if (!old) return old;
    const notifications = old.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    );
    return {
      ...old,
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
    };
  });
}

/** Mark all notifications for a task as read in caches (task chats). */
export function markTaskNotificationsReadInCache(utils: TrpcUtils, taskId: number) {
  const markTaskInList = (old: NotificationListData | undefined) => {
    if (!old) return old;
    let changed = false;
    const notifications = old.notifications.map((n) => {
      const nTaskId = (n as { taskId?: number | null }).taskId;
      if (nTaskId === taskId && !n.read) {
        changed = true;
        return { ...n, read: true };
      }
      return n;
    });
    if (!changed) return old;
    return {
      ...old,
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
    };
  };

  utils.notification.list.setData(NOTIFICATION_LIST_ALL, markTaskInList);
  utils.notification.list.setData({ limit: 100, unreadOnly: false }, markTaskInList);

  utils.notification.list.setData(NOTIFICATION_LIST_UNREAD, (old) => {
    if (!old) return old;
    const notifications = old.notifications.filter(
      (n) => (n as { taskId?: number | null }).taskId !== taskId,
    );
    return {
      ...old,
      notifications,
      unreadCount: notifications.length,
    };
  });
}
