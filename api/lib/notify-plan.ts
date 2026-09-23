import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, NotificationType, UserDoc } from "@db/mongo/types";
import { getCollection, hasMongoConfigured, insertDoc } from "../queries/connection";

export type PlanNotifyKind = "joined" | "updated" | "cancelled";

type PlanNotifyInput = {
  kind: PlanNotifyKind;
  organizationId: number;
  organizationName: string;
  planName: string;
  actorId?: number | null;
  notifyCrm?: boolean;
  notifyPlatform?: boolean;
};

function typeForKind(kind: PlanNotifyKind): NotificationType {
  if (kind === "joined") return "plan_joined";
  if (kind === "cancelled") return "plan_cancelled";
  return "plan_updated";
}

function copyForKind(kind: PlanNotifyKind, orgName: string, planName: string) {
  if (kind === "joined") {
    return {
      crm: {
        title: "Plan activated",
        message: `Your workspace is on the ${planName} plan.`,
      },
      platform: {
        title: "New subscription",
        message: `${orgName} joined Aaso on the ${planName} plan.`,
      },
    };
  }
  if (kind === "cancelled") {
    return {
      crm: {
        title: "Plan cancelled",
        message: `The ${planName} plan for this workspace was cancelled. Choose a plan in Pricing to continue.`,
      },
      platform: {
        title: "Plan cancelled",
        message: `${orgName}'s ${planName} plan was cancelled.`,
      },
    };
  }
  return {
    crm: {
      title: "Plan updated",
      message: `Your workspace plan is now ${planName}. Menu access follows this plan.`,
    },
    platform: {
      title: "Plan updated",
      message: `${orgName} is now on the ${planName} plan.`,
    },
  };
}

async function notifyUsers(
  users: UserDoc[],
  payload: {
    type: NotificationType;
    title: string;
    message: string;
    actorId: number | null;
    relatedOrganizationId: number;
  },
) {
  if (users.length === 0) return;
  const now = new Date();
  await Promise.all(
    users.map((user) =>
      insertDoc<NotificationDoc>(Collections.notifications, {
        userId: user.id,
        organizationId: user.organizationId ?? null,
        actorId: payload.actorId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        taskId: null,
        relatedOrganizationId: payload.relatedOrganizationId,
        read: false,
        createdAt: now,
      }),
    ),
  );
}

/** Alert CRM workspace admins and/or Aaso master admins about a plan event. */
export async function notifyPlanChange(input: PlanNotifyInput) {
  if (!hasMongoConfigured()) return;

  const notifyCrm = input.notifyCrm !== false;
  const notifyPlatform = input.notifyPlatform !== false;
  if (!notifyCrm && !notifyPlatform) return;

  const type = typeForKind(input.kind);
  const copy = copyForKind(input.kind, input.organizationName, input.planName);
  const actorId = input.actorId ?? null;
  const userCol = await getCollection<UserDoc>(Collections.users);

  const jobs: Array<Promise<void>> = [];

  if (notifyCrm) {
    jobs.push(
      userCol
        .find({
          organizationId: input.organizationId,
          role: { $in: ["admin", "client", "finance"] },
          status: "active",
        })
        .toArray()
        .then((users) =>
          notifyUsers(users, {
            type,
            title: copy.crm.title,
            message: copy.crm.message,
            actorId,
            relatedOrganizationId: input.organizationId,
          }),
        ),
    );
  }

  if (notifyPlatform) {
    jobs.push(
      userCol
        .find({
          role: "platform",
          status: "active",
        })
        .toArray()
        .then((users) =>
          notifyUsers(
            users.filter((user) => user.id !== actorId),
            {
              type,
              title: copy.platform.title,
              message: copy.platform.message,
              actorId,
              relatedOrganizationId: input.organizationId,
            },
          ),
        ),
    );
  }

  await Promise.all(jobs);
}

export function queuePlanNotification(input: PlanNotifyInput) {
  void notifyPlanChange(input).catch((error) => {
    console.error("[notify-plan]", error);
  });
}
