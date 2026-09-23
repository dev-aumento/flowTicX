import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { OrganizationDoc, SafeUser, SubscriptionPlan, SubscriptionStatus, UserDoc, WorkspaceType } from "@db/mongo/types";
import { Workspace } from "@contracts/constants";
import { addPlanDuration } from "@/lib/platform-admin";
import { findById, getCollection, hasMongoConfigured, insertDoc, updateById } from "../queries/connection";

export type { WorkspaceType };

/** Resolve the caller's organization id or fail closed. */
export function requireOrganizationId(
  user: Pick<SafeUser | UserDoc, "organizationId" | "id">,
): number {
  if (user.organizationId == null || user.organizationId <= 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account is not linked to an organization. Contact support.",
    });
  }
  return user.organizationId;
}

/** Mongo filter fragment for the caller's tenant. */
export function orgFilter(user: Pick<SafeUser | UserDoc, "organizationId" | "id">) {
  return { organizationId: requireOrganizationId(user) };
}

/** True when the resource belongs to the caller's organization. */
export function belongsToUserOrg(
  user: Pick<SafeUser | UserDoc, "organizationId" | "id">,
  resourceOrgId: number | null | undefined,
) {
  return resourceOrgId != null && resourceOrgId === requireOrganizationId(user);
}

export async function findOrganizationById(id: number) {
  return findById<OrganizationDoc>(Collections.organizations, id);
}

export async function createOrganization(
  name: string,
  createdBy: number | null = null,
  options?: {
    workspaceType?: WorkspaceType;
    plan?: SubscriptionPlan;
    planStatus?: SubscriptionStatus;
    subscriptionAmount?: number;
    purchasedAt?: Date | null;
  },
) {
  const now = new Date();
  const workspaceType = options?.workspaceType ?? "standard";
  const isCustomer = workspaceType !== "platform";
  return insertDoc<OrganizationDoc>(Collections.organizations, {
    name: name.trim() || Workspace.name,
    workspaceType,
    plan: options?.plan ?? (isCustomer ? "trial" : undefined),
    planStatus: options?.planStatus ?? (isCustomer ? "trial" : undefined),
    subscriptionAmount: options?.subscriptionAmount ?? (isCustomer ? 0 : undefined),
    purchasedAt: options?.purchasedAt ?? (isCustomer ? now : null),
    planStartsAt: isCustomer ? now : null,
    planExpiresAt: isCustomer ? addPlanDuration(now, options?.plan ?? "trial") : null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * True when this org is (or should be healed as) a client portal workspace.
 * Existing client orgs created before workspaceType are inferred from a client-role owner.
 */
export async function resolveClientWorkspace(
  organizationId: number | null | undefined,
): Promise<boolean> {
  if (organizationId == null || organizationId <= 0) return false;
  if (!hasMongoConfigured()) return false;

  const org = await findOrganizationById(organizationId);
  if (!org) return false;
  if (org.workspaceType === "client") return true;
  if (org.workspaceType === "standard" || org.workspaceType === "platform") return false;

  const userCol = await getCollection<UserDoc>(Collections.users);
  const clientOwner = await userCol.findOne({
    organizationId,
    role: "client",
    status: "active",
  });
  if (!clientOwner) {
    await updateById<OrganizationDoc>(Collections.organizations, organizationId, {
      workspaceType: "standard",
      updatedAt: new Date(),
    });
    return false;
  }

  // Staff CRMs always have an admin and may later invite clients. Inferring
  // "client portal" from any client user would hide Client's Tasks from admins.
  const staffAdmin = await userCol.findOne({
    organizationId,
    role: "admin",
    status: "active",
  });
  if (staffAdmin) {
    await updateById<OrganizationDoc>(Collections.organizations, organizationId, {
      workspaceType: "standard",
      updatedAt: new Date(),
    });
    return false;
  }

  await updateById<OrganizationDoc>(Collections.organizations, organizationId, {
    workspaceType: "client",
    updatedAt: new Date(),
  });
  return true;
}

export async function getOrganizationNameById(id: number | null | undefined) {
  if (id == null) return Workspace.name;
  const org = await findOrganizationById(id);
  return org?.name?.trim() || Workspace.name;
}

/**
 * One-time backfill: put all legacy rows into a default organization
 * so existing admins keep their data while new orgs stay isolated.
 */
export async function ensureDefaultOrganizationMigration() {
  const orgCol = await getCollection<OrganizationDoc>(Collections.organizations);
  const userCol = await getCollection<UserDoc>(Collections.users);

  let defaultOrg: OrganizationDoc | null = await orgCol.findOne({}, { sort: { id: 1 } });

  if (!defaultOrg) {
    const settings = await getCollection<{ key: string; name?: string }>(Collections.appSettings);
    const settingsDoc = await settings.findOne({ key: "organization" });
    const name = settingsDoc?.name?.trim() || Workspace.name;
    defaultOrg = await createOrganization(name, null);
  }

  const orgId = defaultOrg.id;
  const tenantCollections = [
    Collections.users,
    Collections.employees,
    Collections.employeeInvites,
    Collections.projects,
    Collections.tasks,
    Collections.leaveRequests,
    Collections.publicHolidays,
    Collections.leaveUsageOverrides,
    Collections.timeEntries,
    Collections.timeApprovalRequests,
    Collections.notifications,
    Collections.employeeDocuments,
    Collections.formerEmployees,
    Collections.formerEmployeeDocuments,
    Collections.customers,
    Collections.invoices,
  ] as const;

  for (const name of tenantCollections) {
    const col = await getCollection(name);
    await col.updateMany(
      {
        $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
      },
      { $set: { organizationId: orgId } },
    );
  }

  if (defaultOrg.createdBy == null) {
    const firstAdmin = await userCol.findOne(
      { organizationId: orgId, role: "admin" },
      { sort: { id: 1 } },
    );
    if (firstAdmin) {
      await updateById<OrganizationDoc>(Collections.organizations, orgId, {
        createdBy: firstAdmin.id,
        updatedAt: new Date(),
      });
    }
  }

  return orgId;
}
