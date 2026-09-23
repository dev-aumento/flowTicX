import { useEffect, useState } from "react";

export type NotificationPrefKey =
  | "taskAssignments"
  | "statusChanges"
  | "mentions"
  | "dueDateReminders"
  | "weeklySummary";

export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

export const NOTIFICATION_PREF_ITEMS: {
  key: NotificationPrefKey;
  label: string;
  desc: string;
}[] = [
  {
    key: "taskAssignments",
    label: "Task Assignments",
    desc: "When you are assigned to a new task",
  },
  {
    key: "statusChanges",
    label: "Status Changes",
    desc: "When a task you follow changes status",
  },
  {
    key: "mentions",
    label: "Mentions",
    desc: "When someone mentions you in a task",
  },
  {
    key: "dueDateReminders",
    label: "Due Date Reminders",
    desc: "When a task deadline is reached or overdue",
  },
  {
    key: "weeklySummary",
    label: "Weekly Summary",
    desc: "Weekly report of your activity",
  },
];

/** All preference categories enabled by default for every employee. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  taskAssignments: true,
  statusChanges: true,
  mentions: true,
  dueDateReminders: true,
  weeklySummary: true,
};

const LEGACY_NOTIFICATIONS_KEY = "settings-notifications";
const NOTIFICATIONS_KEY_PREFIX = "settings-notifications";
const PREFS_CHANGED_EVENT = "notification-prefs-changed";

function storageKey(userId: number) {
  return `${NOTIFICATIONS_KEY_PREFIX}-${userId}`;
}

function normalizePrefs(partial?: Partial<NotificationPrefs> | null): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(partial ?? {}) };
}

export function readNotificationPrefs(userId: number): NotificationPrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw) {
      return normalizePrefs(JSON.parse(raw) as Partial<NotificationPrefs>);
    }

    // One-time migrate from the old shared (non-user) key.
    const legacyRaw = localStorage.getItem(LEGACY_NOTIFICATIONS_KEY);
    if (legacyRaw) {
      const migrated = normalizePrefs(JSON.parse(legacyRaw) as Partial<NotificationPrefs>);
      writeNotificationPrefs(userId, migrated);
      return migrated;
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_NOTIFICATION_PREFS };
}

export function writeNotificationPrefs(userId: number, prefs: NotificationPrefs) {
  const next = normalizePrefs(prefs);
  localStorage.setItem(storageKey(userId), JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent(PREFS_CHANGED_EVENT, { detail: { userId } }),
  );
}

/**
 * Returns false when the notification belongs to a preference category the
 * employee has disabled. Types not covered by Settings prefs always show.
 */
export function isNotificationAllowedByPrefs(
  notif: { type?: string | null; title?: string | null },
  prefs: NotificationPrefs,
): boolean {
  const type = notif.type ?? "";
  const title = (notif.title ?? "").toLowerCase();

  if (type === "task_assigned") return prefs.taskAssignments;
  if (type === "mention") return prefs.mentions;
  if (type === "deadline_reminder") return prefs.dueDateReminders;
  if (type === "weekly_summary" || title.includes("weekly summary")) {
    return prefs.weeklySummary;
  }
  if (type === "task_updated" && title.includes("status changed")) {
    return prefs.statusChanges;
  }

  return true;
}

export function filterNotificationsByPrefs<T extends { type?: string | null; title?: string | null }>(
  notifications: T[],
  prefs: NotificationPrefs,
): T[] {
  return notifications.filter((n) => isNotificationAllowedByPrefs(n, prefs));
}

export function useNotificationPrefs(userId: number | undefined): NotificationPrefs {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() =>
    userId ? readNotificationPrefs(userId) : { ...DEFAULT_NOTIFICATION_PREFS },
  );

  useEffect(() => {
    if (!userId) {
      setPrefs({ ...DEFAULT_NOTIFICATION_PREFS });
      return;
    }

    setPrefs(readNotificationPrefs(userId));

    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: number }>).detail;
      if (detail?.userId === userId) {
        setPrefs(readNotificationPrefs(userId));
      }
    };

    window.addEventListener(PREFS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PREFS_CHANGED_EVENT, onChange);
  }, [userId]);

  return prefs;
}
