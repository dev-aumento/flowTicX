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
import { findUserById } from "./queries/users";
import { verifyPaymentSignature, readRazorpayKeys } from "./lib/razorpay";
import {
  assertComplimentaryPlan,
  fulfillSubscriptionCheckout,
  resolvePlanPayer,
  startSubscriptionCheckout,
} from "./lib/subscription-checkout";

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
      await assertComplimentaryPlan(input.slug);
      return activateOrganizationPlan({ org, slug: input.slug, actorId: ctx.user.id });
    }),

  beginCheckout: publicQuery
    .input(z.object({ slug: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const payer = await resolvePlanPayer(ctx);
      if (!payer) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sign in as the workspace super admin to pay for a plan.",
        });
      }

      const started = await startSubscriptionCheckout({ payer, slug: input.slug });
      if (started.kind === "payment") {
        return {
          requiresPayment: true as const,
          keyId: started.keyId,
          orderId: started.orderId,
          amount: started.amount,
          currency: started.currency,
          name: started.name,
          description: started.description,
          prefill: started.prefill,
        };
      }

      const plan = await activateOrganizationPlan({
        org: payer.org,
        slug: started.catalog.slug,
        actorId: payer.user.id,
      });
      return attachRenewalSession(ctx, payer.user.id, payer.restoreSession, plan);
    }),

  confirmPayment: publicQuery
    .input(
      z.object({
        orderId: z.string().min(1).max(64),
        paymentId: z.string().min(1).max(64),
        signature: z.string().min(1).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const keys = readRazorpayKeys();
      if (!keys) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Razorpay is not configured on the server.",
        });
      }
      if (!verifyPaymentSignature(input.orderId, input.paymentId, input.signature, keys.keySecret)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment could not be verified." });
      }

      const payer = await resolvePlanPayer(ctx);
      const fulfilled = await fulfillSubscriptionCheckout({
        orderId: input.orderId,
        paymentId: input.paymentId,
      });
      const sameAdmin = payer?.user.id === fulfilled.checkout.userId;
      return attachRenewalSession(
        ctx,
        fulfilled.checkout.userId,
        Boolean(sameAdmin && fulfilled.checkout.restoreSession),
        fulfilled.plan,
      );
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

      await assertComplimentaryPlan(input.slug);
      const plan = await activateOrganizationPlan({ org, slug: input.slug, actorId: user.id });
      clearPlanRenewalCookie(ctx.req.headers, ctx.resHeaders);
      const token = await createSessionForUser(user.id, ctx.req.headers, ctx.resHeaders);
      return { ...plan, user: await toSessionUser(user), token };
    }),
});

async function attachRenewalSession(
  ctx: { req: { headers: Headers }; resHeaders: Headers },
  userId: number,
  restoreSession: boolean,
  plan: {
    organizationId: number;
    organizationName: string;
    plan: string | null;
    planName: string | null;
    planStatus: string | null;
    planFeatures: string[] | null;
    planLimits: unknown;
    subscriptionAmount: number;
    planStartsAt: Date | null;
    planExpiresAt: Date | null;
    durationDays: number | null;
  },
) {
  if (!restoreSession) {
    return {
      requiresPayment: false as const,
      renewedSession: false,
      ...plan,
      user: null,
      token: null,
    };
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace admin not found" });
  }
  clearPlanRenewalCookie(ctx.req.headers, ctx.resHeaders);
  const token = await createSessionForUser(user.id, ctx.req.headers, ctx.resHeaders);
  return {
    requiresPayment: false as const,
    renewedSession: true,
    ...plan,
    user: await toSessionUser(user),
    token,
  };
}
