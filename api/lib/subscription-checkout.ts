import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc, SubscriptionCheckoutDoc } from "@db/mongo/types";
import { findUserById, type SafeUser } from "../queries/users";
import { getCollection, hasMongoConfigured, insertDoc } from "../queries/connection";
import { findOrganizationById } from "./tenant";
import { findPlatformPlan } from "./platform-plans";
import { getSubscriptionBlock, resolveOrgPlanAccess } from "./subscription-access";
import { userFromPlanRenewalCookie } from "./plan-renewal";
import type { PlanLimits } from "@/lib/plan-entitlements";
import { activateOrganizationPlan } from "./activate-plan";
import { createRazorpayOrder, inrRupeesToPaise, planRequiresPayment, readRazorpayKeys } from "./razorpay";
import { provisionPaidSignup, type PaidAccount } from "./paid-signup";
import type { TrpcContext } from "../context";

type PayerUser = Pick<SafeUser, "id" | "role" | "organizationId" | "name" | "email" | "phone"> & {
  firstName?: string | null;
  lastName?: string | null;
};

export type PlanPayer = {
  user: PayerUser;
  org: OrganizationDoc;
  restoreSession: boolean;
};

export async function resolvePlanPayer(ctx: Pick<TrpcContext, "user" | "req">): Promise<PlanPayer | null> {
  const sessionUser = ctx.user;
  if (
    sessionUser &&
    String(sessionUser.role ?? "").toLowerCase() === "admin" &&
    sessionUser.organizationId != null &&
    sessionUser.organizationId > 0
  ) {
    const org = await findOrganizationById(sessionUser.organizationId);
    if (org && org.workspaceType !== "platform") {
      const block = await getSubscriptionBlock(sessionUser);
      return { user: sessionUser, org, restoreSession: block != null };
    }
  }

  const renewalUser = await userFromPlanRenewalCookie(ctx.req.headers);
  if (
    !renewalUser ||
    String(renewalUser.role ?? "").toLowerCase() !== "admin" ||
    renewalUser.organizationId == null
  ) {
    return null;
  }
  const org = await findOrganizationById(renewalUser.organizationId);
  if (!org || org.workspaceType === "platform") return null;
  return { user: renewalUser, org, restoreSession: true };
}

export function payerDisplayName(user: PayerUser) {
  const named = user.name?.trim();
  if (named) return named;
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
}

export async function assertComplimentaryPlan(slug: string) {
  const catalog = await findPlatformPlan(slug);
  if (!catalog) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
  }
  if (planRequiresPayment(catalog)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Pay for this plan with Razorpay before it can start.",
    });
  }
  return catalog;
}

export async function startSubscriptionCheckout(input: {
  payer: PlanPayer;
  slug: string;
}) {
  if (!hasMongoConfigured()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured" });
  }

  const catalog = await findPlatformPlan(input.slug);
  if (!catalog) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
  }
  if (!planRequiresPayment(catalog)) {
    return { kind: "free" as const, catalog };
  }

  const keys = readRazorpayKeys();
  if (!keys) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Razorpay is not configured on the server.",
    });
  }

  const amountPaise = inrRupeesToPaise(catalog.amount);
  if (amountPaise < 100) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This plan price is below the minimum Razorpay charge of ₹1.",
    });
  }

  const order = await createRazorpayOrder({
    keys,
    amountPaise,
    receipt: `a${input.payer.org.id}t${Date.now().toString(36)}`,
    notes: {
      organizationId: String(input.payer.org.id),
      planSlug: catalog.slug,
      userId: String(input.payer.user.id),
    },
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Razorpay could not start this payment.";
    throw new TRPCError({ code: "BAD_REQUEST", message });
  });

  await insertDoc<SubscriptionCheckoutDoc>(Collections.subscriptionCheckouts, {
    organizationId: input.payer.org.id,
    userId: input.payer.user.id,
    planSlug: catalog.slug,
    amountPaise,
    currency: "INR",
    razorpayOrderId: order.id,
    razorpayPaymentId: null,
    status: "created",
    restoreSession: input.payer.restoreSession,
    createdAt: new Date(),
    paidAt: null,
  });

  const contact = String(input.payer.user.phone ?? "").replace(/[^\d]/g, "");
  return {
    kind: "payment" as const,
    keyId: keys.keyId,
    orderId: order.id,
    amount: amountPaise,
    currency: "INR" as const,
    name: "AASO",
    description: `${catalog.name} for ${input.payer.org.name}`,
    prefill: {
      name: payerDisplayName(input.payer.user),
      email: input.payer.user.email?.trim() ?? "",
      contact,
    },
  };
}

/** A visitor with no account pays first. The workspace is created from the Razorpay email. */
export async function startGuestCheckout(slug: string) {
  if (!hasMongoConfigured()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not configured" });
  }
  const catalog = await findPlatformPlan(slug);
  if (!catalog) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
  }
  if (!planRequiresPayment(catalog)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a paid plan to create your account.",
    });
  }
  const keys = readRazorpayKeys();
  if (!keys) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Razorpay is not configured on the server.",
    });
  }
  const amountPaise = inrRupeesToPaise(catalog.amount);
  if (amountPaise < 100) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This plan price is below the minimum Razorpay charge of ₹1.",
    });
  }
  const order = await createRazorpayOrder({
    keys,
    amountPaise,
    receipt: `g${Date.now().toString(36)}`,
    notes: { planSlug: catalog.slug, signup: "guest" },
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Razorpay could not start this payment.";
    throw new TRPCError({ code: "BAD_REQUEST", message });
  });
  await insertDoc<SubscriptionCheckoutDoc>(Collections.subscriptionCheckouts, {
    organizationId: null,
    userId: null,
    buyerEmail: null,
    planSlug: catalog.slug,
    amountPaise,
    currency: "INR",
    razorpayOrderId: order.id,
    razorpayPaymentId: null,
    status: "created",
    restoreSession: false,
    createdAt: new Date(),
    paidAt: null,
  });
  return {
    kind: "payment" as const,
    keyId: keys.keyId,
    orderId: order.id,
    amount: amountPaise,
    currency: "INR" as const,
    name: "AASO",
    description: `${catalog.name}. Enter your email to create your account.`,
    prefill: { name: "", email: "", contact: "" },
  };
}

async function describePaidPlan(org: OrganizationDoc) {
  const catalog = await findPlatformPlan(org.plan ?? "trial");
  const access = await resolveOrgPlanAccess(org);
  return {
    organizationId: org.id,
    organizationName: org.name,
    ...access,
    subscriptionAmount: org.subscriptionAmount ?? catalog?.amount ?? 0,
    planStartsAt: org.planStartsAt ?? null,
    planExpiresAt: org.planExpiresAt ?? null,
    durationDays: catalog?.durationDays ?? null,
  };
}

/** Marks the stored order paid and activates the plan once. */
export async function fulfillSubscriptionCheckout(input: {
  orderId: string;
  paymentId: string;
  amountPaise?: number;
}): Promise<{
  checkout: SubscriptionCheckoutDoc;
  plan: {
    organizationId: number;
    organizationName: string;
    plan: string | null;
    planName: string | null;
    planStatus: string | null;
    planFeatures: string[] | null;
    planLimits: PlanLimits | null;
    subscriptionAmount: number;
    planStartsAt: Date | null;
    planExpiresAt: Date | null;
    durationDays: number | null;
  };
  alreadyPaid: boolean;
  account: PaidAccount | null;
}> {
  const col = await getCollection<SubscriptionCheckoutDoc>(Collections.subscriptionCheckouts);
  const checkout = await col.findOne({ razorpayOrderId: input.orderId });
  if (!checkout) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Payment order was not found." });
  }
  if (input.amountPaise != null && input.amountPaise !== checkout.amountPaise) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Payment amount does not match the plan." });
  }

  if (checkout.status !== "paid") {
    const claimed = await col.findOneAndUpdate(
      { id: checkout.id, status: "created" },
      { $set: { status: "paid", razorpayPaymentId: input.paymentId, paidAt: new Date() } },
      { returnDocument: "after" },
    );
    if (claimed) {
      try {
        if (claimed.organizationId == null || claimed.userId == null) {
          const created = await provisionPaidSignup({
            paymentId: input.paymentId,
            orderId: input.orderId,
            planSlug: claimed.planSlug,
          });
          await col.updateOne(
            { id: claimed.id },
            {
              $set: {
                organizationId: created.organizationId,
                userId: created.userId,
                buyerEmail: created.account.email,
              },
            },
          );
          const saved = await col.findOne({ id: claimed.id });
          return {
            checkout: saved ?? { ...claimed, organizationId: created.organizationId, userId: created.userId, buyerEmail: created.account.email },
            plan: created.plan,
            alreadyPaid: false,
            account: created.account,
          };
        }
        const org = await findOrganizationById(claimed.organizationId);
        if (!org) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
        }
        const plan = await activateOrganizationPlan({
          org,
          slug: claimed.planSlug,
          actorId: claimed.userId,
          paymentConfirmed: true,
        });
        return { checkout: claimed, plan, alreadyPaid: false, account: null };
      } catch (error) {
        await col.updateOne(
          { id: checkout.id },
          { $set: { status: "created", razorpayPaymentId: null, paidAt: null } },
        );
        throw error;
      }
    }
  }

  const paid = (await col.findOne({ razorpayOrderId: input.orderId })) ?? checkout;
  if (paid.organizationId == null || paid.userId == null) {
    const created = await provisionPaidSignup({
      paymentId: input.paymentId,
      orderId: input.orderId,
      planSlug: paid.planSlug,
    });
    await col.updateOne(
      { id: paid.id },
      {
        $set: {
          organizationId: created.organizationId,
          userId: created.userId,
          buyerEmail: created.account.email,
          status: "paid",
          razorpayPaymentId: input.paymentId,
          paidAt: paid.paidAt ?? new Date(),
        },
      },
    );
    const saved = await col.findOne({ id: paid.id });
    return {
      checkout: saved ?? paid,
      plan: created.plan,
      alreadyPaid: true,
      account: created.account,
    };
  }
  const org = await findOrganizationById(paid.organizationId);
  if (!org) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  }
  const buyer = await findUserById(paid.userId);
  const account = paid.buyerEmail
    ? { email: paid.buyerEmail, hasPassword: Boolean(buyer?.passwordHash) }
    : null;
  return {
    checkout: paid,
    alreadyPaid: true,
    account,
    plan: await describePaidPlan(org),
  };
}
