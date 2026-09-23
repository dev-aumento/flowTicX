import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, SafeUser, UserDoc } from "@db/mongo/types";
import { getCollection, insertDoc } from "../queries/connection";
import { isHrDepartmentUser } from "@/lib/leave-policy";

type NotifyLeadsInput = {
  actor: SafeUser;
  type: NotificationDoc["type"];
  title: string;
  message: string;
  taskId?: number | null;
  projectId?: number | null;
  excludeUserIds?: number[];
};

export async function notifyLeads({
  actor,
  type,
  title,
  message,
  taskId = null,
  projectId = null,
  excludeUserIds = [],
}: NotifyLeadsInput) {
  const excluded = new Set([actor.id, ...excludeUserIds]);
  const usersCol = await getCollection<UserDoc>(Collections.users);
  const leads = await usersCol
    .find({
      organizationId: actor.organizationId,
      role: { $in: ["admin", "manager"] },
      status: "active",
    })
    .toArray();

  const recipients = leads.filter(
    (lead) => !excluded.has(lead.id) && !isHrDepartmentUser(lead),
  );
  if (recipients.length === 0) return;

  const now = new Date();
  await Promise.all(
    recipients.map((lead) =>
      insertDoc<NotificationDoc>(Collections.notifications, {
        userId: lead.id,
        organizationId: actor.organizationId,
        actorId: actor.id,
        type,
        title,
        message,
        taskId,
        projectId,
        read: false,
        createdAt: now,
      }),
    ),
  );
}
