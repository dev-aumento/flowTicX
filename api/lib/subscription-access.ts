import { TRPCError } from "@trpc/server";
import type { OrganizationDoc, SafeUser, UserDoc } from "@db/mongo/types";
import { addPlanDuration, DEFAULT_PLATFORM_PLANS, PLAN_FEATURE_CATALOG } from "@/lib/platform-admin";
import { defaultEntitlement, type PlanLimits } from "@/lib/plan-entitlements";
import { findOrganizationById } from "./tenant";
import { findPlatformPlan } from "./platform-plans";
import { hasMongoConfigured } from "../queries/mongo";
import { clearSessionCookie } from "./auth";

export const PLAN_ENDED_TAG = "[PLAN_ENDED]";
export const PLAN_CANCELLED_TAG = "[PLAN_CANCELLED]";

export const PLAN_ENDED_MESSAGE = `${PLAN_ENDED_TAG} Your Aaso plan or trial has ended. Purchase a plan to sign in again.`;
export const PLAN_CANCELLED_MESSAGE = `${PLAN_CANCELLED_TAG} This workspace subscription was cancelled. Purchase a plan to sign in again.`;

function endOfExpiryDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export type OrgPlanAccess = {
  plan: string | null;
  planName: string | null;
  planStatus: string | null;
  planFeatures: string[] | null;
  /** Null means the workspace is not capped (platform). */
  planLimits: PlanLimits | null;
};

const ALL_FEATURE_KEYS = PLAN_FEATURE_CATALOG.map((feature) => feature.key);

function fallbackFeatureKeys(slug: string) {
  return (
    DEFAULT_PLATFORM_PLANS.find((plan) => plan.slug === slug)?.featureKeys ?? [
      "projects",
      "tasks",
      "files",
    ]
  );
}

export async function resolveOrgPlanAccess(
  org: Pick<OrganizationDoc, "workspaceType" | "plan" | "planStatus"> | null | undefined,
): Promise<OrgPlanAccess> {
  if (!org || org.workspaceType === "platform") {
    return { plan: null, planName: null, planStatus: null, planFeatures: ALL_FEATURE_KEYS, planLimits: null };
  }

  const slug = org.plan ?? "trial";
  const catalog = await findPlatformPlan(slug);
  return {
    plan: slug,
    planName: catalog?.name ?? slug,
    planStatus: org.planStatus ?? (slug === "trial" ? "trial" : "unpaid"),
    planFeatures: catalog?.featureKeys ?? fallbackFeatureKeys(slug),
    planLimits: catalog?.limits ?? defaultEntitlement(slug).limits,
  };
}

export function subscriptionExpiryDate(org: OrganizationDoc, durationDays?: number) {
  const plan = org.plan ?? "trial";
  const start = org.planStartsAt ?? org.purchasedAt ?? org.createdAt;
  if (start) return addPlanDuration(new Date(start), plan, durationDays);
  return org.planExpiresAt ? new Date(org.planExpiresAt) : null;
}

export function subscriptionBlockReason(
  org: Pick<OrganizationDoc, "workspaceType" | "plan" | "planStatus" | "planExpiresAt" | "planStartsAt" | "purchasedAt" | "createdAt">,
  durationDays?: number,
): "expired" | "cancelled" | null {
  if (org.workspaceType === "platform") return null;
  if (org.planStatus === "cancelled") return "cancelled";
  const expires = subscriptionExpiryDate(org as OrganizationDoc, durationDays);
  if (!expires) return null;
  if (endOfExpiryDay(expires).getTime() < Date.now()) return "expired";
  return null;
}

export async function getSubscriptionBlock(
  user: Pick<SafeUser | UserDoc, "role" | "organizationId">,
): Promise<"expired" | "cancelled" | null> {
  if (String(user.role ?? "").toLowerCase() === "platform") return null;
  if (!hasMongoConfigured()) return null;
  if (user.organizationId == null || user.organizationId <= 0) return null;

  const org = await findOrganizationById(user.organizationId);
  if (!org || org.workspaceType === "platform") return null;

  const catalog = await findPlatformPlan(org.plan ?? "trial");
  return subscriptionBlockReason(org, catalog?.durationDays);
}

export function subscriptionBlockError(reason: "expired" | "cancelled") {
  return new TRPCError({
    code: "FORBIDDEN",
    message: reason === "cancelled" ? PLAN_CANCELLED_MESSAGE : PLAN_ENDED_MESSAGE,
  });
}

export async function assertActiveSubscription(
  user: Pick<SafeUser | UserDoc, "role" | "organizationId">,
  session?: { reqHeaders: Headers; resHeaders: Headers },
) {
  const reason = await getSubscriptionBlock(user);
  if (!reason) return;
  if (session) {
    clearSessionCookie(session.reqHeaders, session.resHeaders);
  }
  throw subscriptionBlockError(reason);
}
