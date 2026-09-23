import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, SafeUser, UserDoc } from "@db/mongo/types";
import { getCollection, insertDoc } from "../queries/connection";
import { canManageLeaves } from "@/lib/leave-policy";

type NotifyLeaveManagersInput = {
  actor: SafeUser;
  type: NotificationDoc["type"];
  title: string;
  message: string;
  leaveRequestId?: number | null;
  excludeUserIds?: number[];
};

/** Notify admins and HR department users about leave activity. */
export async function notifyLeaveManagers({
  actor,
  type,
  title,
  message,
  leaveRequestId = null,
  excludeUserIds = [],
}: NotifyLeaveManagersInput) {
  const excluded = new Set([actor.id, ...excludeUserIds]);
  const usersCol = await getCollection<UserDoc>(Collections.users);
  const candidates = await usersCol
    .find({ organizationId: actor.organizationId, status: "active" })
    .toArray();

  const recipients = candidates.filter(
    (user) => canManageLeaves(user) && !excluded.has(user.id),
  );
  if (recipients.length === 0) return;

  const now = new Date();
  await Promise.all(
    recipients.map((user) =>
      insertDoc<NotificationDoc>(Collections.notifications, {
        userId: user.id,
        organizationId: actor.organizationId,
        actorId: actor.id,
        type,
        title,
        message,
        taskId: null,
        leaveRequestId,
        read: false,
        createdAt: now,
      }),
    ),
  );
}
