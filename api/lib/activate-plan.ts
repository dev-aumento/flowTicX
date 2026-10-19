import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc } from "@db/mongo/types";
import { addPlanDuration } from "@/lib/platform-admin";
import { findPlatformPlan } from "./platform-plans";
import { hasMongoConfigured, updateById } from "../queries/connection";
import { canStartIntroPlanTrial, INTRO_TRIAL_DAYS, introTrialStillOpen, resolveOrgPlanAccess } from "./subscription-access";
import { planRequiresPayment } from "./razorpay";
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
  const unlimited = !planRequiresPayment(catalog);
  const expiresAt = unlimited ? null : addPlanDuration(startsAt, catalog.slug, catalog.durationDays);
  const isTrial = unlimited;
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
    introPlanTrial: false,
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
  return presentActivatedPlan(updated, access, unlimited ? null : catalog.durationDays, startsAt, expiresAt);
}

/** One free month of the plan the customer chose. Payment starts only after that month. */
export async function startSelectedPlanTrial(input: {
  org: OrganizationDoc;
  slug: string;
  actorId: number | null;
}) {
  if (!hasMongoConfigured()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured" });
  }
  const catalog = await findPlatformPlan(input.slug);
  if (!catalog) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
  }
  if (!planRequiresPayment(catalog)) {
    return activateOrganizationPlan(input);
  }
  if (!canStartIntroPlanTrial(input.org)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Your free month has ended. Purchase a plan to continue.",
    });
  }

  const now = new Date();
  const continuing = introTrialStillOpen(input.org);
  const startsAt = continuing && input.org.planStartsAt ? new Date(input.org.planStartsAt) : now;
  const expiresAt = addPlanDuration(startsAt, catalog.slug, INTRO_TRIAL_DAYS);
  const updated = await updateById<OrganizationDoc>(Collections.organizations, input.org.id, {
    plan: catalog.slug,
    planStatus: "trial",
    subscriptionAmount: 0,
    purchasedAt: input.org.purchasedAt ?? now,
    planStartsAt: startsAt,
    planExpiresAt: expiresAt,
    planCancelledAt: null,
    planCancelReason: null,
    introEnterprise: false,
    introPlanTrial: true,
    updatedAt: now,
  });
  if (!updated) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  }

  const previousSlug = input.org.plan ?? "trial";
  if (previousSlug !== catalog.slug) {
    queuePlanNotification({
      kind: "updated",
      organizationId: updated.id,
      organizationName: updated.name,
      planName: `${catalog.name} (1 month free)`,
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
  return presentActivatedPlan(updated, access, INTRO_TRIAL_DAYS, startsAt, expiresAt);
}

function presentActivatedPlan(
  updated: OrganizationDoc,
  access: Awaited<ReturnType<typeof resolveOrgPlanAccess>>,
  durationDays: number | null,
  startsAt: Date,
  expiresAt: Date | null,
) {
  return {
    organizationId: updated.id,
    organizationName: updated.name,
    ...access,
    subscriptionAmount: updated.subscriptionAmount ?? 0,
    planStartsAt: updated.planStartsAt ?? startsAt,
    planExpiresAt: expiresAt,
    durationDays,
  };
}
