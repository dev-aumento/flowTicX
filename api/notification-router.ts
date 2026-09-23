import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { isAuthDisabled } from "./lib/dev-mode";
import * as mock from "./lib/mock-store";
import {
  getCollection,
  updateById,
  countDocs,
  hasMongoConfigured,
} from "./queries/connection";
import { Collections } from "@db/mongo/collections";
import type { NotificationDoc } from "@db/mongo/types";
import { ensureSchema } from "./lib/migrate";
import { isHrDepartmentUser, isTaskRelatedNotification } from "@/lib/leave-policy";
import { personalizeNotificationCopy } from "@/lib/viewer-second-person";

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

function filterNotificationsForViewer<T extends {
  type?: string | null;
  taskId?: number | null;
  projectId?: number | null;
}>(
  viewer: { role?: string | null; department?: string | null },
  notifications: T[],
) {
  if (!isHrDepartmentUser(viewer)) return notifications;
  return notifications.filter((notification) => !isTaskRelatedNotification(notification));
}

export const notificationRouter = createRouter({
  list: authedQuery
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        page: z.number().default(1),
        limit: z.number().default(50),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { unreadOnly = false, page = 1, limit = 50 } = input || {};
      if (useMock()) {
        const result = mock.mockNotificationList(ctx.user.id, unreadOnly);
        const notifications = filterNotificationsForViewer(ctx.user, result.notifications).map(
          (notification) => personalizeNotificationCopy(notification, ctx.user),
        );
        return {
          ...result,
          notifications,
          unreadCount: notifications.filter((n) => !n.read).length,
        };
      }

      await ensureSchema();
      const offset = (page - 1) * limit;

      const filter: Record<string, unknown> = { userId: ctx.user.id };
      if (unreadOnly) filter.read = false;

      const col = await getCollection<NotificationDoc>(Collections.notifications);

      if (isHrDepartmentUser(ctx.user)) {
        const [rawNotifs, allUnread] = await Promise.all([
          col.find(filter).sort({ createdAt: -1 }).skip(offset).limit(Math.max(limit * 3, 50)).toArray(),
          col.find({ userId: ctx.user.id, read: false }).toArray(),
        ]);
        const notifications = filterNotificationsForViewer(ctx.user, rawNotifs)
          .slice(0, limit)
          .map((notification) => personalizeNotificationCopy(notification, ctx.user));
        return {
          notifications,
          unreadCount: filterNotificationsForViewer(ctx.user, allUnread).length,
        };
      }

      const [notifs, unreadCount] = await Promise.all([
        col.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
        countDocs(Collections.notifications, { userId: ctx.user.id, read: false }),
      ]);

      return {
        notifications: notifs.map((notification) =>
          personalizeNotificationCopy(notification, ctx.user),
        ),
        unreadCount,
      };
    }),

  markRead: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (useMock()) return mock.mockMarkNotificationRead(ctx.user.id, input.id);

      await ensureSchema();
      return updateById<NotificationDoc>(Collections.notifications, input.id, { read: true });
    }),

  markReadForTask: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (useMock()) {
        return mock.mockMarkTaskNotificationsRead(ctx.user.id, input.taskId);
      }

      await ensureSchema();
      const col = await getCollection<NotificationDoc>(Collections.notifications);
      const unread = await col
        .find({ userId: ctx.user.id, read: false })
        .toArray();

      const idsToMark = unread
        .filter((n) => {
          if (n.taskId === input.taskId) return true;
          return false;
        })
        .map((n) => n.id);

      if (idsToMark.length > 0) {
        await col.updateMany(
          { userId: ctx.user.id, id: { $in: idsToMark } },
          { $set: { read: true } },
        );
      }

      return { success: true, count: idsToMark.length };
    }),

  markAllRead: authedQuery
    .mutation(async ({ ctx }) => {
      if (useMock()) return mock.mockMarkAllNotificationsRead(ctx.user.id);

      await ensureSchema();
      const col = await getCollection<NotificationDoc>(Collections.notifications);
      await col.updateMany(
        { userId: ctx.user.id, read: false },
        { $set: { read: true } },
      );
      return { success: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (useMock()) return mock.mockDeleteNotification(ctx.user.id, input.id);

      await ensureSchema();
      const col = await getCollection<NotificationDoc>(Collections.notifications);
      await col.deleteOne({ id: input.id });
      return { success: true };
    }),
});
