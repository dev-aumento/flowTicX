const DISMISSED_TOAST_KEY = "notification-toast-dismissed";

export function readDismissedNotificationIds(userId: number): Set<number> {
  try {
    const raw = localStorage.getItem(`${DISMISSED_TOAST_KEY}-${userId}`);
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as number[];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export function dismissNotificationToast(userId: number, notificationId: number) {
  const dismissed = readDismissedNotificationIds(userId);
  dismissed.add(notificationId);
  localStorage.setItem(`${DISMISSED_TOAST_KEY}-${userId}`, JSON.stringify([...dismissed]));
}
