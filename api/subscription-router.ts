import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc } from "@db/mongo/types";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { hasMongoConfigured, updateById } from "./queries/connection";
import { findOrganizationById, requireOrganizationId } from "./lib/tenant";
import { findPlatformPlan, listPlatformPlans } from "./lib/platform-plans";
import { addPlanDuration } from "@/lib/platform-admin";
import { resolveOrgPlanAccess, settleIntroEnterprise } from "./lib/subscription-access";
import { isFreeTierPlan, planDaysRemaining, planExpiryWarning } from "./lib/plan-expiry";
import { invalidateAuthUserCache } from "./lib/auth";
import { queuePlanNotification } from "./lib/notify-plan";
import { ensureSampleProjects } from "./lib/sample-workspace";

export const subscriptionRouter = createRouter({
  plans: authedQuery.query(async () => listPlatformPlans()),

  current: authedQuery.query(async ({ ctx }) => {
    const organizationId = requireOrganizationId(ctx.user);
    const org = await findOrganizationById(organizationId);
    if (!org || org.workspaceType === "platform") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
    }
    const settled = await settleIntroEnterprise(org);
    const access = await resolveOrgPlanAccess(settled);
    const catalog = access.plan ? await findPlatformPlan(access.plan) : null;
    const planStartsAt = settled.planStartsAt ?? settled.purchasedAt ?? settled.createdAt ?? null;
    const planExpiresAt = planStartsAt
      ? addPlanDuration(new Date(planStartsAt), settled.plan ?? "trial", catalog?.durationDays)
      : settled.planExpiresAt ?? null;
    const daysRemaining =
      planExpiresAt && !isFreeTierPlan(settled.plan)
        ? planDaysRemaining(new Date(planExpiresAt))
        : null;
    const introEnterprise = Boolean(settled.introEnterprise);
    return {
      organizationId,
      organizationName: settled.name,
      ...access,
      introEnterprise,
      subscriptionAmount: introEnterprise ? 0 : settled.subscriptionAmount ?? catalog?.amount ?? 0,
      planStartsAt,
      planExpiresAt,
      durationDays: catalog?.durationDays ?? null,
      daysRemaining,
      expiryWarning: planExpiryWarning(daysRemaining),
    };
  }),

  selectPlan: adminQuery
    .input(z.object({ slug: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      if (!hasMongoConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured",
        });
      }

      const organizationId = requireOrganizationId(ctx.user);
      const org = await findOrganizationById(organizationId);
      if (!org || org.workspaceType === "platform") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      const catalog = await findPlatformPlan(input.slug);
      if (!catalog) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      const now = new Date();
      const startsAt = now;
      const expiresAt = addPlanDuration(startsAt, catalog.slug, catalog.durationDays);
      const isTrial = catalog.slug === "trial" || catalog.amount === 0;
      const planStatus = isTrial ? "trial" : org.planStatus === "paid" ? "paid" : "unpaid";

      const updated = await updateById<OrganizationDoc>(Collections.organizations, org.id, {
        plan: catalog.slug,
        planStatus,
        subscriptionAmount: catalog.amount,
        purchasedAt: org.purchasedAt ?? now,
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

      const previousSlug = org.plan ?? "trial";
      const previousStatus = org.planStatus ?? "trial";
      const sameActivePlan = previousSlug === catalog.slug && previousStatus !== "cancelled";
      if (!sameActivePlan) {
        queuePlanNotification({
          kind: previousStatus === "cancelled" ? "joined" : "updated",
          organizationId: updated.id,
          organizationName: updated.name,
          planName: catalog.name,
          actorId: ctx.user.id,
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
        organizationId,
        organizationName: updated.name,
        ...access,
        subscriptionAmount: updated.subscriptionAmount ?? catalog.amount,
        planStartsAt: updated.planStartsAt ?? startsAt,
        planExpiresAt: updated.planExpiresAt ?? expiresAt,
        durationDays: catalog.durationDays,
      };
    }),
});
