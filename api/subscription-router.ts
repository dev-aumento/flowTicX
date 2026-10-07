import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, publicQuery } from "./middleware";
import { findOrganizationById, requireOrganizationId } from "./lib/tenant";
import { findPlatformPlan, listPlatformPlans } from "./lib/platform-plans";
import { addPlanDuration } from "@/lib/platform-admin";
import { resolveOrgPlanAccess, settleIntroEnterprise } from "./lib/subscription-access";
import { isFreeTierPlan, planDaysRemaining, planExpiryWarning } from "./lib/plan-expiry";
import { activateOrganizationPlan } from "./lib/activate-plan";
import { clearPlanRenewalCookie, userFromPlanRenewalCookie } from "./lib/plan-renewal";
import { createSessionForUser } from "./lib/auth";
import { toSessionUser } from "./lib/client-workspace";

export const subscriptionRouter = createRouter({
  plans: authedQuery.query(async () => listPlatformPlans()),

  /** Public catalog used on the plan-ended renew page. Same plans the master admin maintains. */
  catalog: publicQuery.query(async () => listPlatformPlans()),

  renewContext: publicQuery.query(async ({ ctx }) => {
    const user = await userFromPlanRenewalCookie(ctx.req.headers);
    if (!user) {
      return { signedIn: false, canRenew: false, organizationName: null as string | null, name: null as string | null };
    }
    const org =
      user.organizationId != null ? await findOrganizationById(user.organizationId) : null;
    return {
      signedIn: true,
      canRenew: String(user.role ?? "").toLowerCase() === "admin" && org?.workspaceType !== "platform",
      organizationName: org?.name ?? null,
      name: user.name?.trim() || user.email || null,
    };
  }),

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
      const organizationId = requireOrganizationId(ctx.user);
      const org = await findOrganizationById(organizationId);
      if (!org || org.workspaceType === "platform") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }
      return activateOrganizationPlan({ org, slug: input.slug, actorId: ctx.user.id });
    }),

  renew: publicQuery
    .input(z.object({ slug: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const user = await userFromPlanRenewalCookie(ctx.req.headers);
      if (!user || String(user.role ?? "").toLowerCase() !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sign in as the workspace super admin to renew this plan.",
        });
      }
      if (user.organizationId == null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }
      const org = await findOrganizationById(user.organizationId);
      if (!org || org.workspaceType === "platform") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      const plan = await activateOrganizationPlan({ org, slug: input.slug, actorId: user.id });
      clearPlanRenewalCookie(ctx.req.headers, ctx.resHeaders);
      const token = await createSessionForUser(user.id, ctx.req.headers, ctx.resHeaders);
      return { ...plan, user: await toSessionUser(user), token };
    }),
});
