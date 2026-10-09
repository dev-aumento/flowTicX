import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc } from "@db/mongo/types";
import { addPlanDuration } from "@/lib/platform-admin";
import { findPlatformPlan } from "./platform-plans";
import { hasMongoConfigured, updateById } from "../queries/connection";
import { resolveOrgPlanAccess } from "./subscription-access";
import { invalidateAuthUserCache } from "./auth";
import { queuePlanNotification } from "./notify-plan";
import { ensureSampleProjects } from "./sample-workspace";

/** Apply a catalog plan to a workspace and unlock only that plan's features and limits. */
export async function activateOrganizationPlan(input: {
  org: OrganizationDoc;
  slug: string;
  actorId: number | null;
  /** Set when Razorpay has confirmed the charge for this activation. */
  paymentConfirmed?: boolean;
}) {
  if (!hasMongoConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Database is not configured",
    });
  }

  const catalog = await findPlatformPlan(input.slug);
  if (!catalog) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
  }

  const now = new Date();
  const startsAt = now;
  const expiresAt = addPlanDuration(startsAt, catalog.slug, catalog.durationDays);
  const isTrial = catalog.slug === "trial" || catalog.amount === 0;
  const planStatus = isTrial ? "trial" : input.paymentConfirmed ? "paid" : input.org.planStatus === "paid" ? "paid" : "unpaid";

  const updated = await updateById<OrganizationDoc>(Collections.organizations, input.org.id, {
    plan: catalog.slug,
    planStatus,
    subscriptionAmount: catalog.amount,
    purchasedAt: input.org.purchasedAt ?? now,
    planStartsAt: startsAt,
    planExpiresAt: expiresAt,
    planCancelledAt: null,
    planCancelReason: null,
    introEnterprise: false,
    updatedAt: now,
  });
  if (!updated) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  }

  const previousSlug = input.org.plan ?? "trial";
  const previousStatus = input.org.planStatus ?? "trial";
  const sameActivePlan = previousSlug === catalog.slug && previousStatus !== "cancelled";
  if (!sameActivePlan) {
    queuePlanNotification({
      kind: previousStatus === "cancelled" ? "joined" : "updated",
      organizationId: updated.id,
      organizationName: updated.name,
      planName: catalog.name,
      actorId: input.actorId,
    });
  }

  invalidateAuthUserCache();
  try {
    await ensureSampleProjects(updated.id, updated.plan ?? "trial");
  } catch (error) {
    console.error("[subscription] Sample projects were not updated:", error);
  }

  const access = await resolveOrgPlanAccess(updated);
  return {
    organizationId: updated.id,
    organizationName: updated.name,
    ...access,
    subscriptionAmount: updated.subscriptionAmount ?? catalog.amount,
    planStartsAt: updated.planStartsAt ?? startsAt,
    planExpiresAt: updated.planExpiresAt ?? expiresAt,
    durationDays: catalog.durationDays,
  };
}
