import { DEFAULT_PERMISSIONS_BY_ROLE, type SafeUser, type UserDoc } from "@db/mongo/types";
import { Collections } from "@db/mongo/collections";
import { updateById } from "../queries/connection";
import { omitPasswordHash } from "../queries/users";
import { findOrganizationById, resolveClientWorkspace } from "./tenant";
import { resolveOrgPlanAccess, settleIntroEnterprise, type OrgPlanAccess } from "./subscription-access";

/** Task/project access invited teammates need in a client portal. Owners keep invoices/team. */
export const CLIENT_WORKSPACE_MEMBER_PERMISSIONS = [
  "dashboard.view",
  "projects.view",
  "projects.manage",
  "tasks.view_all",
  "tasks.create",
  "tasks.edit_all",
  "tasks.change_assignee",
] as const;

/** External clients invited into a staff CRM — client dashboard + assign work to the team. */
export const INVITED_CLIENT_PERMISSIONS = [
  "dashboard.view",
  "projects.view",
  "tasks.view_own",
  "tasks.create",
  "tasks.edit_own",
  "tasks.change_assignee",
] as const;

export type SessionUser = SafeUser & {
  clientWorkspace: boolean;
  invitedStaffClient: boolean;
} & OrgPlanAccess;

export async function isClientWorkspaceUser(user: {
  role?: string | null;
  organizationId?: number | null;
}): Promise<boolean> {
  const role = String(user.role ?? "").toLowerCase();
  if (role === "finance" || role === "platform") return false;
  if (role === "client") return true;
  return resolveClientWorkspace(user.organizationId);
}

export async function toSessionUser(
  user: UserDoc | SafeUser,
  clientWorkspace?: boolean,
): Promise<SessionUser> {
  const base = "passwordHash" in user ? omitPasswordHash(user as UserDoc) : (user as SafeUser);
  const role = String(base.role ?? "").toLowerCase();
  const orgIsClientWorkspace =
    role === "platform" || role === "finance"
      ? false
      : await resolveClientWorkspace(base.organizationId);
  const invitedStaffClient = role === "client" && !orgIsClientWorkspace;
  const resolved =
    clientWorkspace ??
    (role === "client" ? true : orgIsClientWorkspace);
  const loaded =
    base.organizationId != null && base.organizationId > 0
      ? await findOrganizationById(base.organizationId).catch(() => null)
      : null;
  const org = loaded ? await settleIntroEnterprise(loaded).catch(() => loaded) : null;
  const planAccess = await resolveOrgPlanAccess(org);
  return {
    ...base,
    clientWorkspace: resolved,
    invitedStaffClient,
    ...planAccess,
  };
}

export async function healPortalUser(user: UserDoc): Promise<UserDoc> {
  if (user.role === "client") {
    const orgIsClientWorkspace = await resolveClientWorkspace(user.organizationId);
    return healPermissions(
      user,
      orgIsClientWorkspace
        ? DEFAULT_PERMISSIONS_BY_ROLE.client
        : [...INVITED_CLIENT_PERMISSIONS],
      ["invoices.manage"],
    );
  }

  if (user.role === "finance" || user.role === "admin" || user.role === "platform") {
    return user;
  }

  const clientWorkspace = await resolveClientWorkspace(user.organizationId);
  if (!clientWorkspace) return user;

  return healPermissions(user, [...CLIENT_WORKSPACE_MEMBER_PERMISSIONS]);
}

async function healPermissions(
  user: UserDoc,
  needed: string[],
  remove: string[] = [],
): Promise<UserDoc> {
  const current = user.permissions ?? [];
  const stripped = current.filter((key) => !remove.includes(key));
  const merged = [...new Set([...stripped, ...needed])];
  const unchanged =
    merged.length === current.length && merged.every((key) => current.includes(key));
  if (unchanged) return user;

  const healed = await updateById<UserDoc>(Collections.users, user.id, {
    permissions: merged,
    updatedAt: new Date(),
  });
  if (healed) {
    const { invalidateAuthUserCache } = await import("./auth");
    invalidateAuthUserCache(user.id);
    return healed;
  }
  return { ...user, permissions: merged };
}
