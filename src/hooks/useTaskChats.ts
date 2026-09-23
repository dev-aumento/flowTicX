import { useMemo } from "react";
import { useStableTaskChatOrder } from "@/lib/stable-list-order";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { isHrDepartmentUser } from "@/lib/leave-policy";
import { parseTaskIdFromLink } from "@/lib/task-notification-link";
import { notificationListQueryOptions } from "@/hooks/useNotificationStream";

type TaskRow = {
  id: number;
  title: string;
  assigneeId?: number | null;
  createdBy?: number | null;
  participantIds?: number[];
  observerIds?: number[];
  assignee?: { name: string | null; avatar?: string | null } | null;
};

/** Notifications that represent task chat / comment activity. */
const CHAT_NOTIFICATION_TYPES = new Set(["mention"]);

function getNotificationTaskId(notification: {
  taskId?: number | null;
  link?: string | null;
}): number | null {
  if (notification.taskId) return notification.taskId;
  return parseTaskIdFromLink(notification.link);
}

function isRelatedToUser(task: TaskRow, userId: number) {
  if (task.assigneeId === userId) return true;
  if (task.createdBy === userId) return true;
  if (task.participantIds?.includes(userId)) return true;
  if (task.observerIds?.includes(userId)) return true;
  return false;
}

type UseTaskChatsOptions = {
  /** When false, skip the heavy task list + notification fan-out (Sidebar uses badge-only). */
  enabled?: boolean;
};

export function useTaskChats(options?: UseTaskChatsOptions) {
  const enabled = options?.enabled ?? true;
  const { user } = useAuth();
  const isHr = isHrDepartmentUser(user);
  const userId = user?.id ?? 0;

  const queryEnabled = enabled && !isHr && userId > 0;

  // Load a broad task set so we can enrich titles and verify membership.
  // Chats themselves are driven by this user's notifications only.
  const { data: taskData, isLoading: tasksLoading } = trpc.task.list.useQuery(
    { limit: 200 },
    {
      enabled: queryEnabled,
      staleTime: 60_000,
    },
  );

  const { data: notifData, isLoading: notifsLoading } = trpc.notification.list.useQuery(
    { unreadOnly: false, limit: 100 },
    { ...notificationListQueryOptions, enabled: queryEnabled },
  );

  const allTasks = queryEnabled ? ((taskData?.tasks ?? []) as TaskRow[]) : [];
  const taskById = useMemo(() => {
    const map = new Map<number, TaskRow>();
    for (const task of allTasks) map.set(task.id, task);
    return map;
  }, [allTasks]);

  const rawTaskChats = useMemo(() => {
    if (!queryEnabled) return [];

    const byTask = new Map<
      number,
      { lastMessage: string; lastAt: Date; unread: boolean; titleHint: string }
    >();

    for (const n of notifData?.notifications ?? []) {
      const type = String(n.type ?? "");
      // Comment / mention chats only — skip leave, time, assignment noise
      if (!CHAT_NOTIFICATION_TYPES.has(type)) continue;

      const taskId = getNotificationTaskId(n);
      if (!taskId) continue;

      const task = taskById.get(taskId);
      // If we know the task, keep only conversations related to this employee
      if (task && !isRelatedToUser(task, userId)) continue;
      // If task isn't in the loaded list, still show it — notification is already for this user

      const at = new Date(n.createdAt);
      const existing = byTask.get(taskId);
      if (!existing) {
        byTask.set(taskId, {
          lastMessage: n.message,
          lastAt: at,
          unread: !n.read,
          titleHint: n.title || `Task #${taskId}`,
        });
        continue;
      }

      if (at > existing.lastAt) {
        existing.lastMessage = n.message;
        existing.lastAt = at;
      }
      if (!n.read) existing.unread = true;
    }

    return [...byTask.entries()].map(([taskId, meta]) => {
      const task = taskById.get(taskId);
      return {
        taskId,
        title: task?.title ?? meta.titleHint,
        lastMessage: meta.lastMessage,
        lastAt: meta.lastAt,
        unread: meta.unread,
        assignee: task?.assignee ?? null,
      };
    });
  }, [notifData, taskById, queryEnabled, userId]);

  const taskChats = useStableTaskChatOrder(rawTaskChats);

  const unreadTaskCount = useMemo(
    () => taskChats.filter((chat) => chat.unread).length,
    [taskChats],
  );

  return {
    taskChats,
    taskChatsCount: queryEnabled ? unreadTaskCount : 0,
    isLoading: queryEnabled ? tasksLoading || notifsLoading : false,
  };
}

/** Lightweight Sidebar badge — unread comment/mention chats only. */
export function useTaskChatBadgeCount() {
  const { user } = useAuth();
  const isHr = isHrDepartmentUser(user);

  const { data } = trpc.notification.list.useQuery(
    { unreadOnly: true, limit: 50 },
    {
      ...notificationListQueryOptions,
      enabled: !!user && !isHr,
    },
  );

  return useMemo(() => {
    if (isHr) return 0;
    const taskIds = new Set<number>();
    for (const n of data?.notifications ?? []) {
      if (!CHAT_NOTIFICATION_TYPES.has(String(n.type ?? ""))) continue;
      const taskId = getNotificationTaskId(n);
      if (taskId) taskIds.add(taskId);
    }
    return taskIds.size;
  }, [data?.notifications, isHr]);
}
