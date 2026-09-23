import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc } from "@db/mongo/types";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { hasMongoConfigured, updateById } from "./queries/connection";
import { findOrganizationById, requireOrganizationId } from "./lib/tenant";
import { findPlatformPlan, listPlatformPlans } from "./lib/platform-plans";
import { addPlanDuration } from "@/lib/platform-admin";
import { resolveOrgPlanAccess } from "./lib/subscription-access";
import { invalidateAuthUserCache } from "./lib/auth";
import { queuePlanNotification } from "./lib/notify-plan";

export const subscriptionRouter = createRouter({
  plans: authedQuery.query(async () => listPlatformPlans()),

  current: authedQuery.query(async ({ ctx }) => {
    const organizationId = requireOrganizationId(ctx.user);
    const org = await findOrganizationById(organizationId);
    if (!org || org.workspaceType === "platform") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
    }
    const access = await resolveOrgPlanAccess(org);
    const catalog = access.plan ? await findPlatformPlan(access.plan) : null;
    const planStartsAt = org.planStartsAt ?? org.purchasedAt ?? org.createdAt ?? null;
    const planExpiresAt = planStartsAt
      ? addPlanDuration(new Date(planStartsAt), org.plan ?? "trial", catalog?.durationDays)
      : org.planExpiresAt ?? null;
    return {
      organizationId,
      organizationName: org.name,
      ...access,
      subscriptionAmount: org.subscriptionAmount ?? catalog?.amount ?? 0,
      planStartsAt,
      planExpiresAt,
      durationDays: catalog?.durationDays ?? null,
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
