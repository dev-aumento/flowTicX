import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { NotificationDoc, UserDoc } from "@db/mongo/types";
import { defaultEntitlement, deriveFeatureKeys } from "@/lib/plan-entitlements";
import { getCollection, insertDoc } from "../queries/connection";
import { findOrganizationById } from "./tenant";
import { findPlatformPlan } from "./platform-plans";

export const PLAN_LIMIT_MESSAGE =
  "You've reached your plan limits. Upgrade your plan to use more tools or functions.";

export const PLAN_FEATURE_MESSAGE =
  "This isn't included in your plan. Upgrade your plan to use more tools or functions.";

type PlanUser = {
  id?: number | null;
  role?: string | null;
  organizationId?: number | null;
};

export async function assertPlanFeature(user: PlanUser, feature: string) {
  if (String(user.role ?? "").toLowerCase() === "platform") return;
  const organizationId = user.organizationId;
  if (organizationId == null || organizationId <= 0) return;

  const org = await findOrganizationById(organizationId);
  if (!org || org.workspaceType === "platform") return;

  const slug = org.plan ?? "trial";
  const catalog = await findPlatformPlan(slug);
  const preset = defaultEntitlement(slug);
  const allowed = catalog?.featureKeys?.length
    ? catalog.featureKeys
    : deriveFeatureKeys(preset.highlightKeys, preset.limits);
  if (allowed.includes(feature)) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: PLAN_FEATURE_MESSAGE,
  });
}

/** One bell notification per person per day when a numeric cap is hit. */
export async function notifyPlanLimitReached(organizationId: number, actorId: number | null) {
  try {
    const users = await getCollection<UserDoc>(Collections.users);
    const recipients = await users
      .find({
        organizationId,
        status: { $nin: ["inactive", "suspended"] },
        $or: [{ role: "admin" }, ...(actorId ? [{ id: actorId }] : [])],
      })
      .toArray();

    const notifications = await getCollection<NotificationDoc>(Collections.notifications);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date();

    await Promise.all(
      recipients.map(async (recipient) => {
        const existing = await notifications.findOne({
          userId: recipient.id,
          type: "plan_limit",
          createdAt: { $gte: since },
        });
        if (existing) return;
        const link = String(recipient.role).toLowerCase() === "admin" ? "/admin/pricing" : "/";
        await insertDoc<NotificationDoc>(Collections.notifications, {
          userId: recipient.id,
          organizationId,
          actorId,
          type: "plan_limit",
          title: "Plan limit reached",
          message: PLAN_LIMIT_MESSAGE,
          taskId: null,
          link,
          relatedOrganizationId: organizationId,
          read: false,
          createdAt: now,
        });
      }),
    );
  } catch {
    // The limit block still applies if the notification cannot be saved.
  }
}

