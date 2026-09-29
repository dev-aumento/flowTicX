import { createRouter, platformQuery } from "./middleware";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc, SubscriptionPlan, SubscriptionStatus, UserDoc } from "@db/mongo/types";
import { getCollection, hasMongoConfigured, updateById } from "./queries/connection";
import { findUserByEmail } from "./queries/users";
import { addPlanDuration } from "@/lib/platform-admin";
import { findPlatformPlan, listPlatformPlans, upsertPlatformPlan, deletePlatformPlan } from "./lib/platform-plans";
import { deleteCustomerOrganization } from "./lib/delete-customer-org";
import { invalidateAuthUserCache } from "./lib/auth";
import { queuePlanNotification } from "./lib/notify-plan";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const planSchema = z.string().min(1).max(64);
const statusSchema = z.enum(["trial", "paid", "unpaid", "cancelled"]);
const limitField = z.number().int().min(0).max(1_000_000).nullable();

const planInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(80),
  amount: z.number().min(0).max(10_000_000),
  description: z.string().max(400),
  durationDays: z.number().int().min(1).max(3650),
  limits: z.object({
    projects: limitField,
    teamMembers: limitField,
    storageGb: limitField,
  }),
  highlightKeys: z.array(z.string().min(1).max(60)).max(80),
  badge: z.string().max(40).nullable(),
  ctaLabel: z.string().min(1).max(40),
  storageLabel: z.string().max(80).nullable(),
});

type CustomerRow = {
  id: number;
  name: string;
  ownerName: string;
  ownerEmail: string | null;
  ownerPhone: string | null;
  workspaceType: "client" | "standard";
  plan: SubscriptionPlan;
  planName?: string;
  planStatus: SubscriptionStatus;
  subscriptionAmount: number;
  purchasedAt: Date | null;
  planStartsAt: Date | null;
  planExpiresAt: Date | null;
  planCancelledAt: Date | null;
  planCancelReason: string | null;
  planNotes: string | null;
  memberCount: number;
  createdAt: Date;
};

function normalizeOrg(
  org: OrganizationDoc,
  plansBySlug: Map<string, { name: string; amount: number; durationDays: number }>,
) {
  const workspaceType: "client" | "standard" =
    org.workspaceType === "client" ? "client" : "standard";
  const plan: SubscriptionPlan = org.plan ?? "trial";
  const catalog = plansBySlug.get(plan);
  const planStatus: SubscriptionStatus =
    org.planStatus ?? (plan === "trial" ? "trial" : "unpaid");
  const subscriptionAmount =
    typeof org.subscriptionAmount === "number"
      ? org.subscriptionAmount
      : catalog?.amount ?? 0;
  const purchasedAt = org.purchasedAt ?? org.createdAt ?? null;
  const planStartsAt = org.planStartsAt ?? purchasedAt;
  const planExpiresAt = planStartsAt
    ? addPlanDuration(planStartsAt, plan, catalog?.durationDays)
    : null;
  return {
    workspaceType,
    plan,
    planName: catalog?.name ?? plan,
    planStatus,
    subscriptionAmount,
    purchasedAt,
    planStartsAt,
    planExpiresAt,
    planCancelledAt: org.planCancelledAt ?? null,
    planCancelReason: org.planCancelReason ?? null,
    planNotes: org.planNotes ?? null,
    createdAt: org.createdAt,
  };
}

function pickOwner(org: OrganizationDoc, members: UserDoc[]) {
  const byCreated = members.find((user) => user.id === org.createdBy);
  if (byCreated) return byCreated;
  return (
    members.find((user) => user.role === "client") ??
    members.find((user) => user.role === "admin") ??
    members[0] ??
    null
  );
}

function matchesSearch(row: CustomerRow, search: string) {
  if (!search) return true;
  const haystack = [
    row.name,
    row.ownerName,
    row.ownerEmail ?? "",
    row.plan,
    row.planStatus,
    row.workspaceType,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search);
}

async function listCustomerOrgs(): Promise<CustomerRow[]> {
  if (!hasMongoConfigured()) return [];

  const plans = await listPlatformPlans();
  const plansBySlug = new Map(plans.map((plan) => [plan.slug, plan]));
  const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
  const userCol = await getCollection<UserDoc>(Collections.users);
  const orgs = await orgCol
    .find({ workspaceType: { $ne: "platform" } })
    .sort({ purchasedAt: -1, createdAt: -1 })
    .toArray();

  const orgIds = orgs.map((org) => org.id);
  const users =
    orgIds.length === 0
      ? []
      : await userCol
          .find({
            organizationId: { $in: orgIds },
            role: { $ne: "platform" },
          })
          .toArray();

  const byOrg = new Map<number, UserDoc[]>();
  for (const user of users) {
    if (user.organizationId == null) continue;
    const list = byOrg.get(user.organizationId) ?? [];
    list.push(user);
    byOrg.set(user.organizationId, list);
  }

  return orgs.map((org) => {
    const members = byOrg.get(org.id) ?? [];
    const owner = pickOwner(org, members);
    const normalized = normalizeOrg(org, plansBySlug);
    return {
      id: org.id,
      name: org.name,
      ownerName: owner?.name?.trim() || owner?.email || "Unknown",
      ownerEmail: owner?.email ?? null,
      ownerPhone: owner?.phone ?? null,
      memberCount: members.length,
      ...normalized,
    };
  });
}

async function getCustomerOrg(organizationId: number) {
  if (!hasMongoConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Database is not configured",
    });
  }
  const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
  const org = await orgCol.findOne({ id: organizationId });
  if (!org || org.workspaceType === "platform") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
  }
  return org;
}

function splitAdminName(fullName: string | null | undefined) {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function syncPlanDurationForSubscribers(slug: string, durationDays: number) {
  if (!hasMongoConfigured()) return 0;

  const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
  const orgs = await orgCol
    .find({
      plan: slug,
      workspaceType: { $ne: "platform" },
      planStatus: { $ne: "cancelled" },
    })
    .toArray();

  const now = new Date();
  let updatedCount = 0;
  for (const org of orgs) {
    const start = org.planStartsAt ?? org.purchasedAt ?? org.createdAt ?? now;
    const nextExpiry = addPlanDuration(new Date(start), slug, durationDays);
    const previousExpiry = org.planExpiresAt ? new Date(org.planExpiresAt).getTime() : null;
    if (previousExpiry === nextExpiry.getTime()) continue;

    const updated = await updateById<OrganizationDoc>(Collections.organizations, org.id, {
      planExpiresAt: nextExpiry,
      updatedAt: now,
    });
    if (updated) updatedCount += 1;
  }

  if (updatedCount > 0) {
    invalidateAuthUserCache();
  }
  return updatedCount;
}

function normalizeLogoDataUrl(value: string | null) {
  if (value == null || !value.trim()) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:image/")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Logo must be an image file",
    });
  }
  return trimmed;
}

async function loadPlatformSettings(user: {
  id: number;
  organizationId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  const fromName = splitAdminName(user.name);
  const fallback = {
    organizationName: "Aaso",
    logoDataUrl: null as string | null,
    firstName: user.firstName?.trim() || fromName.firstName,
    lastName: user.lastName?.trim() || fromName.lastName,
    email: user.email?.trim() || "",
    phone: user.phone?.trim() || "",
  };

  if (!hasMongoConfigured()) return fallback;

  const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
  const userCol = await getCollection<UserDoc>(Collections.users);
  const [org, freshUser] = await Promise.all([
    user.organizationId
      ? orgCol.findOne({ id: user.organizationId })
      : orgCol.findOne({ workspaceType: "platform" }),
    userCol.findOne({ id: user.id }),
  ]);
  const split = splitAdminName(freshUser?.name ?? user.name);
  return {
    organizationName: org?.name?.trim() || fallback.organizationName,
    logoDataUrl: org?.logoDataUrl ?? null,
    firstName: freshUser?.firstName?.trim() || split.firstName,
    lastName: freshUser?.lastName?.trim() || split.lastName,
    email: freshUser?.email?.trim() || fallback.email,
    phone: freshUser?.phone?.trim() || fallback.phone,
  };
}

export const platformRouter = createRouter({
  overview: platformQuery.query(async () => {
    const [customers, plans] = await Promise.all([listCustomerOrgs(), listPlatformPlans()]);
    const paid = customers.filter((row) => row.planStatus === "paid");
    const trials = customers.filter((row) => row.planStatus === "trial");
    const planDistribution = plans.map((plan) => ({
      id: plan.slug,
      name: plan.name,
      count: customers.filter((row) => row.plan === plan.slug).length,
    }));

    return {
      clients: customers.length,
      activeTrials: trials.length,
      paidPlans: paid.length,
      subscriptionRevenue: paid.reduce((sum, row) => sum + row.subscriptionAmount, 0),
      recentSubscriptions: customers.slice(0, 8),
      planDistribution,
    };
  }),

  listClients: platformQuery
    .input(
      z
        .object({
          search: z.string().max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const search = input?.search?.trim().toLowerCase() ?? "";
      const customers = await listCustomerOrgs();
      return customers.filter((row) => matchesSearch(row, search));
    }),

  listInvitedClients: platformQuery
    .input(
      z
        .object({
          search: z.string().max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      if (!hasMongoConfigured()) return [];

      const search = input?.search?.trim().toLowerCase() ?? "";
      const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
      const userCol = await getCollection<UserDoc>(Collections.users);
      const [orgs, users] = await Promise.all([
        orgCol.find({ workspaceType: { $ne: "platform" } }).toArray(),
        userCol.find({ role: "client" }).toArray(),
      ]);
      const orgById = new Map(orgs.map((org) => [org.id, org]));

      return users
        .filter((user) => {
          const org =
            user.organizationId != null ? orgById.get(user.organizationId) ?? null : null;
          // Standalone client portals are listed under Clients. Invited clients live in a staff CRM.
          if (!org) return true;
          return org.workspaceType !== "client";
        })
        .map((user) => {
          const org =
            user.organizationId != null ? orgById.get(user.organizationId) ?? null : null;
          return {
            id: user.id,
            name: user.name?.trim() || user.email || "Client",
            email: user.email ?? null,
            status: user.status ?? "active",
            organizationId: org?.id ?? null,
            organizationName: org?.name ?? "Unknown workspace",
            createdAt: user.createdAt,
          };
        })
        .filter((row) => {
          if (!search) return true;
          return [row.name, row.email ?? "", row.organizationName]
            .join(" ")
            .toLowerCase()
            .includes(search);
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    }),

  getInvitedClient: platformQuery
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      if (!hasMongoConfigured()) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invited client not found" });
      }

      const userCol = await getCollection<UserDoc>(Collections.users);
      const user = await userCol.findOne({ id: input.userId, role: "client" });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invited client not found" });
      }

      const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
      const org =
        user.organizationId != null
          ? await orgCol.findOne({ id: user.organizationId })
          : null;
      if (org?.workspaceType === "client") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This person is a subscribed client workspace, not an invited client",
        });
      }

      const assignedIds = [...new Set((user.assignedEmployeeIds ?? []).map(Number).filter((id) => id > 0))];
      const assigned =
        assignedIds.length > 0
          ? await userCol.find({ id: { $in: assignedIds } }).toArray()
          : [];
      const assignedById = new Map(assigned.map((member) => [member.id, member]));

      return {
        id: user.id,
        name: user.name?.trim() || user.email || "Client",
        email: user.email ?? null,
        phone: user.phone ?? null,
        status: user.status ?? "active",
        createdAt: user.createdAt,
        clientCanViewTimeTracking: user.clientCanViewTimeTracking === true,
        clientCanViewDueDate: user.clientCanViewDueDate === true,
        assignedEmployees: assignedIds.map((id) => {
          const member = assignedById.get(id);
          return {
            id,
            name: member?.name?.trim() || member?.email || "Employee",
            email: member?.email ?? null,
          };
        }),
        organizationId: org?.id ?? null,
        organizationName: org?.name ?? "Unknown workspace",
      };
    }),

  getClient: platformQuery
    .input(z.object({ organizationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const org = await getCustomerOrg(input.organizationId);
      const plans = await listPlatformPlans();
      const plansBySlug = new Map(plans.map((plan) => [plan.slug, plan]));
      const userCol = await getCollection<UserDoc>(Collections.users);
      const members = await userCol
        .find({ organizationId: org.id, role: { $ne: "platform" } })
        .toArray();
      const owner = pickOwner(org, members);
      const normalized = normalizeOrg(org, plansBySlug);
      return {
        id: org.id,
        name: org.name,
        ownerName: owner?.name?.trim() || owner?.email || "Unknown",
        ownerEmail: owner?.email ?? null,
        ownerPhone: owner?.phone ?? null,
        memberCount: members.length,
        members: members.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        })),
        assignedPlan: plansBySlug.get(normalized.plan) ?? null,
        ...normalized,
      };
    }),

  updateSubscription: platformQuery
    .input(
      z.object({
        organizationId: z.number().int().positive(),
        plan: planSchema,
        planStatus: statusSchema,
        subscriptionAmount: z.number().min(0).max(10_000_000).optional(),
        planNotes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await getCustomerOrg(input.organizationId);
      const catalog = await findPlatformPlan(input.plan);
      const amount =
        input.subscriptionAmount ??
        (input.planStatus === "cancelled"
          ? org.subscriptionAmount ?? 0
          : catalog?.amount ?? org.subscriptionAmount ?? 0);
      const planStartsAt = org.planStartsAt ?? org.purchasedAt ?? org.createdAt ?? new Date();
      const planExpiresAt = addPlanDuration(planStartsAt, input.plan, catalog?.durationDays);
      const purchasedAt =
        input.planStatus === "paid" && !org.purchasedAt ? new Date() : org.purchasedAt;
      const cancelled =
        input.planStatus === "cancelled"
          ? {
              planCancelledAt: org.planCancelledAt ?? new Date(),
              planCancelReason: org.planCancelReason ?? null,
            }
          : { planCancelledAt: null, planCancelReason: null };

      const updated = await updateById<OrganizationDoc>(Collections.organizations, org.id, {
        plan: input.plan,
        planStatus: input.planStatus,
        subscriptionAmount: amount,
        purchasedAt: purchasedAt ?? new Date(),
        planStartsAt,
        planExpiresAt,
        planNotes: input.planNotes === undefined ? org.planNotes ?? null : input.planNotes,
        ...cancelled,
        updatedAt: new Date(),
      });
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }

      const planChanged = (org.plan ?? "trial") !== input.plan;
      const statusChanged = (org.planStatus ?? "trial") !== input.planStatus;
      if (planChanged || statusChanged) {
        const kind =
          input.planStatus === "cancelled"
            ? "cancelled"
            : org.planStatus === "cancelled"
              ? "joined"
              : "updated";
        queuePlanNotification({
          kind,
          organizationId: org.id,
          organizationName: org.name,
          planName: catalog?.name ?? input.plan,
          actorId: ctx.user.id,
        });
      }

      const customers = await listCustomerOrgs();
      return customers.find((row) => row.id === org.id) ?? null;
    }),

  cancelPlan: platformQuery
    .input(
      z.object({
        organizationId: z.number().int().positive(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await getCustomerOrg(input.organizationId);
      const updated = await updateById<OrganizationDoc>(Collections.organizations, org.id, {
        planStatus: "cancelled",
        planCancelledAt: new Date(),
        planCancelReason: input.reason?.trim() || org.planCancelReason || null,
        updatedAt: new Date(),
      });
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }
      if (org.planStatus !== "cancelled") {
        const catalog = await findPlatformPlan(org.plan ?? "trial");
        queuePlanNotification({
          kind: "cancelled",
          organizationId: org.id,
          organizationName: org.name,
          planName: catalog?.name ?? org.plan ?? "plan",
          actorId: ctx.user.id,
        });
      }
      const customers = await listCustomerOrgs();
      return customers.find((row) => row.id === org.id) ?? null;
    }),

  deleteClient: platformQuery
    .input(z.object({ organizationId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      return deleteCustomerOrganization(input.organizationId);
    }),

  plans: platformQuery.query(async () => listPlatformPlans()),

  upsertPlan: platformQuery.input(planInputSchema).mutation(async ({ input }) => {
    const previous = input.id
      ? (await listPlatformPlans()).find((plan) => plan.id === input.id) ?? null
      : null;
    const saved = await upsertPlatformPlan(input);
    let subscribersUpdated = 0;
    if (previous && previous.durationDays !== saved.durationDays) {
      subscribersUpdated = await syncPlanDurationForSubscribers(
        saved.slug,
        saved.durationDays,
      );
    }
    return { ...saved, subscribersUpdated };
  }),

  deletePlan: platformQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const plans = await listPlatformPlans();
      const target = plans.find((plan) => plan.id === input.id);
      if (target) {
        const customers = await listCustomerOrgs();
        if (customers.some((row) => row.plan === target.slug)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This plan is assigned to a customer. Reassign them first.",
          });
        }
      }
      return deletePlatformPlan(input.id);
    }),

  settings: platformQuery.query(async ({ ctx }) => {
    return loadPlatformSettings(ctx.user);
  }),

  updateSettings: platformQuery
    .input(
      z.object({
        organizationName: z.string().min(1).max(200),
        logoDataUrl: z.string().max(2_000_000).nullable().optional(),
        firstName: z.string().min(1).max(80),
        lastName: z.string().max(80),
        email: z.string().email().max(320),
        phone: z.string().max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationName = input.organizationName.trim();
      const firstName = input.firstName.trim();
      const lastName = input.lastName.trim();
      const email = input.email.trim().toLowerCase();
      const phone = input.phone.trim();
      const fullName = [firstName, lastName].filter(Boolean).join(" ");
      const logoDataUrl =
        input.logoDataUrl === undefined ? undefined : normalizeLogoDataUrl(input.logoDataUrl);

      if (!hasMongoConfigured()) {
        return {
          organizationName,
          logoDataUrl: logoDataUrl ?? null,
          firstName,
          lastName,
          email,
          phone,
        };
      }

      const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
      const org = ctx.user.organizationId
        ? await orgCol.findOne({ id: ctx.user.organizationId })
        : await orgCol.findOne({ workspaceType: "platform" });
      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Platform organization not found" });
      }

      const existingEmail = await findUserByEmail(email);
      if (existingEmail && existingEmail.id !== ctx.user.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      await updateById<OrganizationDoc>(Collections.organizations, org.id, {
        name: organizationName,
        ...(logoDataUrl !== undefined ? { logoDataUrl } : {}),
        updatedAt: new Date(),
      });

      await updateById<UserDoc>(Collections.users, ctx.user.id, {
        firstName,
        lastName: lastName || null,
        name: fullName,
        email,
        phone: phone || null,
        updatedAt: new Date(),
      });
      invalidateAuthUserCache(ctx.user.id);

      return loadPlatformSettings(ctx.user);
    }),
});
