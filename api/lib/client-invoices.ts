import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type { CustomerDoc, SafeUser } from "@db/mongo/types";
import { getCollection } from "../queries/connection";
import { orgFilter } from "./tenant";
import { assertPermission, hasPermission } from "./permissions";
import { isClientWorkspaceUser } from "./client-workspace";

export function isClientRole(user: Pick<SafeUser, "role">) {
  return String(user.role ?? "").toLowerCase() === "client";
}

export function isClientInvoiceViewer(user: Pick<SafeUser, "role">) {
  return isClientRole(user);
}

export function canManageInvoices(user: Pick<SafeUser, "role" | "permissions">) {
  if (isClientRole(user)) return false;
  return hasPermission(user, "invoices.manage");
}

export function canAccessOrgInvoices(user: Pick<SafeUser, "role" | "permissions">) {
  return canManageInvoices(user);
}

export function assertCanMutateInvoices(user: Pick<SafeUser, "role" | "permissions">) {
  if (isClientInvoiceViewer(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Clients can view invoices but cannot change them",
    });
  }
  assertPermission(user, "invoices.manage");
}

/** Customer records in this org that represent the signed-in client. */
export async function customerIdsForClientUser(user: SafeUser): Promise<number[]> {
  const col = await getCollection<CustomerDoc>(Collections.customers);
  const linked = await col
    .find({ ...orgFilter(user), sourceUserId: user.id })
    .project({ id: 1 })
    .toArray();
  if (linked.length > 0) return linked.map((row) => row.id);

  const email = user.email?.trim().toLowerCase();
  if (!email) return [];
  const byEmail = await col
    .find({ ...orgFilter(user), email })
    .project({ id: 1 })
    .toArray();
  return byEmail.map((row) => row.id);
}

/** Staff-CRM customers billed to this client portal user or client workspace. */
export async function customerIdsForClientPortal(user: SafeUser): Promise<number[]> {
  const ids = new Set<number>(await customerIdsForClientUser(user));
  const col = await getCollection<CustomerDoc>(Collections.customers);
  if (user.organizationId != null) {
    const byOrg = await col
      .find({ sourceOrganizationId: user.organizationId })
      .project({ id: 1 })
      .toArray();
    for (const row of byOrg) ids.add(row.id);
  }
  return [...ids];
}

export async function isClientPortalInvoiceViewer(user: SafeUser) {
  if (isClientRole(user)) return true;
  return isClientWorkspaceUser(user);
}

export function clientVisibleInvoiceStatusFilter() {
  return { status: { $ne: "draft" as const } };
}
