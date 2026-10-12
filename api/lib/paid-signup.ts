import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { ALL_PERMISSION_KEYS } from "@contracts/permissions";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc, UserDoc } from "@db/mongo/types";
import { createUser, findUsersByEmail } from "../queries/users";
import { updateById } from "../queries/connection";
import { createOrganization, findOrganizationById } from "./tenant";
import { activateOrganizationPlan } from "./activate-plan";
import { fetchRazorpayPayment, readRazorpayKeys } from "./razorpay";
import { seedSampleWorkspaceOnce } from "./sample-workspace";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PaidAccount = {
  email: string;
  hasPassword: boolean;
};

function displayNameFromEmail(email: string) {
  const local = email.split("@")[0]?.replace(/[._+-]+/g, " ").trim() || "Workspace";
  return local.replace(/\b\w/g, (char) => char.toUpperCase()).slice(0, 80);
}

function isDuplicateKey(error: unknown) {
  return typeof error === "object" && error != null && "code" in error && (error as { code?: number }).code === 11000;
}

async function customerAdmin(email: string) {
  const matches = await findUsersByEmail(email);
  for (const user of matches) {
    if (String(user.status ?? "").toLowerCase() !== "active") continue;
    if (user.organizationId == null || user.organizationId <= 0) continue;
    const role = String(user.role ?? "").toLowerCase();
    if (role !== "admin") continue;
    const org = await findOrganizationById(user.organizationId);
    if (!org || org.workspaceType === "platform") continue;
    return { user, org };
  }
  const taken = matches.find((user) => String(user.status ?? "").toLowerCase() === "active");
  return taken ? { user: taken, org: null } : null;
}

/** Creates the paid workspace, or applies the plan to the admin who already uses this email. */
export async function provisionPaidSignup(input: {
  paymentId: string;
  orderId: string;
  planSlug: string;
}): Promise<{ organizationId: number; userId: number; account: PaidAccount; plan: Awaited<ReturnType<typeof activateOrganizationPlan>> }> {
  const keys = readRazorpayKeys();
  if (!keys) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Razorpay is not configured on the server." });
  }
  const payment = await fetchRazorpayPayment(keys, input.paymentId).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Razorpay could not confirm this payment.";
    throw new TRPCError({ code: "BAD_REQUEST", message });
  });
  if (payment.orderId && payment.orderId !== input.orderId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Payment does not match this order." });
  }
  if (payment.status && payment.status !== "captured" && payment.status !== "authorized") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Payment is not complete yet." });
  }
  const email = payment.email;
  if (!EMAIL_PATTERN.test(email)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter an email in the payment window so your account can be created.",
    });
  }

  const found = await customerAdmin(email);
  if (found?.org) {
    const plan = await activateOrganizationPlan({
      org: found.org,
      slug: input.planSlug,
      actorId: found.user.id,
      paymentConfirmed: true,
    });
    if (payment.contact && !found.user.phone) {
      await updateById<UserDoc>(Collections.users, found.user.id, {
        phone: payment.contact,
        updatedAt: new Date(),
      });
    }
    return {
      organizationId: found.org.id,
      userId: found.user.id,
      account: { email, hasPassword: Boolean(found.user.passwordHash) },
      plan,
    };
  }
  if (found?.user) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This email already belongs to an Aaso account. Sign in with it, or pay with a different email.",
    });
  }

  const name = displayNameFromEmail(email);
  const org = await createOrganization(name, null, {
    plan: "trial",
    planStatus: "trial",
    subscriptionAmount: 0,
  });
  let user: UserDoc;
  try {
    user = await createUser({
      unionId: `admin_${nanoid()}`,
      organizationId: org.id,
      name: email,
      email,
      passwordHash: null,
      avatar: null,
      role: "admin",
      status: "active",
      department: "Management",
      position: "Administrator",
      phone: payment.contact || null,
      permissions: [...ALL_PERMISSION_KEYS],
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const again = await customerAdmin(email);
    if (!again?.org) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This email already belongs to an Aaso account. Sign in with it, or pay with a different email.",
      });
    }
    const plan = await activateOrganizationPlan({
      org: again.org,
      slug: input.planSlug,
      actorId: again.user.id,
      paymentConfirmed: true,
    });
    return {
      organizationId: again.org.id,
      userId: again.user.id,
      account: { email, hasPassword: Boolean(again.user.passwordHash) },
      plan,
    };
  }

  await updateById<OrganizationDoc>(Collections.organizations, org.id, {
    createdBy: user.id,
    updatedAt: new Date(),
  });
  const refreshed = (await findOrganizationById(org.id)) ?? org;
  const plan = await activateOrganizationPlan({
    org: refreshed,
    slug: input.planSlug,
    actorId: user.id,
    paymentConfirmed: true,
  });
  try {
    await seedSampleWorkspaceOnce(org.id);
  } catch (error) {
    console.error("[signup] Sample projects were not created:", error);
  }
  return {
    organizationId: org.id,
    userId: user.id,
    account: { email, hasPassword: false },
    plan,
  };
}
