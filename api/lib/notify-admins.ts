import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, SafeUser, UserDoc } from "@db/mongo/types";
import { getCollection, insertDoc } from "../queries/connection";

type NotifyAdminsInput = {
  actor: SafeUser;
  type: NotificationDoc["type"];
  title: string;
  message: string;
  approvalRequestId?: number | null;
  excludeUserIds?: number[];
  /** Roles that should receive the notification. Defaults to admin only. */
  roles?: Array<UserDoc["role"]>;
};

export async function notifyAdmins({
  actor,
  type,
  title,
  message,
  approvalRequestId = null,
  excludeUserIds = [],
  roles = ["admin"],
}: NotifyAdminsInput) {
  const excluded = new Set([actor.id, ...excludeUserIds]);
  const usersCol = await getCollection<UserDoc>(Collections.users);
  const recipientsRaw = await usersCol
    .find({
      organizationId: actor.organizationId,
      role: { $in: roles },
      status: "active",
    })
    .toArray();

  const recipients = recipientsRaw.filter((user) => !excluded.has(user.id));
  if (recipients.length === 0) return;

  const now = new Date();
  await Promise.all(
    recipients.map((recipient) =>
      insertDoc<NotificationDoc>(Collections.notifications, {
        userId: recipient.id,
        organizationId: actor.organizationId,
        actorId: actor.id,
        type,
        title,
        message,
        taskId: null,
        approvalRequestId,
        read: false,
        createdAt: now,
      }),
    ),
  );
}
