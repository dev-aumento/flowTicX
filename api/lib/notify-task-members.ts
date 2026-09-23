import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, SafeUser, TaskDoc, UserDoc } from "@db/mongo/types";
import { findById, getCollection, insertDoc } from "../queries/connection";
import { isHrDepartmentUser } from "@/lib/leave-policy";

type NotifyTaskMembersInput = {
  taskId: number;
  actor: SafeUser | null;
  type: NotificationDoc["type"];
  title: string;
  message: string;
  activityId?: number | null;
  /**
   * Extra recipients (e.g. newly added participant).
   * By default the task owner and assignee are notified unless the include* flags are set.
   */
  extraRecipientIds?: number[];
  excludeUserIds?: number[];
  /** When false, skip the task assignee. Default true. */
  includeAssignee?: boolean;
  /** When false, skip the task owner (createdBy). Default true so clients see task activity. */
  includeOwner?: boolean;
  /** When true, include task participants. Default false. */
  includeParticipants?: boolean;
  /** When true, include task observers. Default false. */
  includeObservers?: boolean;
  /** Organization id when actor is null (system notifications). */
  organizationId?: number | null;
};

export async function getTaskRecipientIds(taskId: number) {
  const task = await findById<TaskDoc>(Collections.tasks, taskId);
  if (!task) {
    return {
      ownerId: null as number | null,
      assigneeId: null as number | null,
      participantIds: [] as number[],
      observerIds: [] as number[],
    };
  }

  const participantCol = await getCollection<{ userId: number; role: string }>(
    Collections.taskParticipants,
  );
  const members = await participantCol.find({ taskId }).toArray();

  return {
    ownerId: task.createdBy,
    assigneeId: task.assigneeId,
    participantIds: members.filter((p) => p.role === "participant").map((p) => p.userId),
    observerIds: members.filter((p) => p.role === "observer").map((p) => p.userId),
  };
}

async function excludeHrRecipientIds(userIds: number[]): Promise<number[]> {
  if (userIds.length === 0) return [];
  const usersCol = await getCollection<UserDoc>(Collections.users);
  const users = await usersCol
    .find({ id: { $in: userIds } })
    .project({ id: 1, role: 1, department: 1 })
    .toArray();
  const allowed = new Set(
    users.filter((user) => !isHrDepartmentUser(user)).map((user) => user.id),
  );
  return userIds.filter((id) => allowed.has(id));
}

export async function notifyTaskMembers({
  taskId,
  actor,
  type,
  title,
  message,
  activityId = null,
  extraRecipientIds = [],
  excludeUserIds = [],
  includeAssignee = true,
  includeOwner = true,
  includeParticipants = false,
  includeObservers = false,
  organizationId = null,
}: NotifyTaskMembersInput) {
  const { ownerId, assigneeId, participantIds, observerIds } = await getTaskRecipientIds(taskId);
  const excluded = new Set([
    ...(actor ? [actor.id] : []),
    ...excludeUserIds,
  ]);
  const recipientIds = new Set<number>();

  if (includeOwner && ownerId != null) {
    recipientIds.add(ownerId);
  }
  if (includeAssignee && assigneeId != null) {
    recipientIds.add(assigneeId);
  }
  if (includeParticipants) {
    for (const id of participantIds) recipientIds.add(id);
  }
  if (includeObservers) {
    for (const id of observerIds) recipientIds.add(id);
  }
  for (const id of extraRecipientIds) recipientIds.add(id);

  const candidates = [...recipientIds].filter((id) => !excluded.has(id));
  const recipients = await excludeHrRecipientIds(candidates);
  if (recipients.length === 0) return;

  const now = new Date();
  const orgId = actor?.organizationId ?? organizationId ?? null;
  await Promise.all(
    recipients.map((userId) =>
      insertDoc<NotificationDoc>(Collections.notifications, {
        userId,
        organizationId: orgId,
        actorId: actor?.id ?? null,
        type,
        title,
        message,
        taskId,
        activityId,
        read: false,
        createdAt: now,
      }),
    ),
  );
}

/** Notify assignee, participants, and observers (for deadline / due-date alerts). */
export async function notifyTaskStakeholders(
  input: Omit<
    NotifyTaskMembersInput,
    "includeAssignee" | "includeParticipants" | "includeObservers"
  >,
) {
  return notifyTaskMembers({
    ...input,
    includeAssignee: true,
    includeOwner: true,
    includeParticipants: true,
    includeObservers: true,
  });
}
