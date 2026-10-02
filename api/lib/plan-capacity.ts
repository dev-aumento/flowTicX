import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import { defaultEntitlement, type PlanLimits } from "@/lib/plan-entitlements";
import { getCollection } from "../queries/connection";
import { findOrganizationById } from "./tenant";
import { findPlatformPlan } from "./platform-plans";
import { notifyPlanLimitReached, PLAN_LIMIT_MESSAGE } from "./plan-guard";

export async function notifyIfProjectLimitReached(organizationId: number, actorId: number | null) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.projects == null) return;
  const projects = await getCollection(Collections.projects);
  const count = await projects.countDocuments({
    organizationId,
    status: { $nin: ["archived"] },
  });
  if (count >= limits.projects) await notifyPlanLimitReached(organizationId, actorId);
}

export async function notifyIfMemberLimitReached(organizationId: number, actorId: number | null) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.teamMembers == null) return;
  const active = await activeMemberCount(organizationId);
  const pending = await pendingEmployeeInviteCount(organizationId);
  if (active + pending >= limits.teamMembers) {
    await notifyPlanLimitReached(organizationId, actorId);
  }
}

export async function limitsForOrganization(organizationId: number): Promise<PlanLimits | null> {
  const org = await findOrganizationById(organizationId);
  if (!org || org.workspaceType === "platform") return null;
  const slug = org.plan ?? "trial";
  const catalog = await findPlatformPlan(slug);
  return catalog?.limits ?? defaultEntitlement(slug).limits;
}

export async function assertCanAddProject(organizationId: number, actorId?: number | null) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.projects == null) return;

  const projects = await getCollection(Collections.projects);
  const count = await projects.countDocuments({
    organizationId,
    status: { $nin: ["archived"] },
  });
  if (count >= limits.projects) {
    await notifyPlanLimitReached(organizationId, actorId ?? null);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: PLAN_LIMIT_MESSAGE,
    });
  }
}

function staffSeatFilter(organizationId: number) {
  return {
    organizationId,
    role: { $nin: ["platform", "client"] },
    status: { $nin: ["inactive", "suspended"] },
  };
}

async function activeMemberCount(organizationId: number) {
  const users = await getCollection(Collections.users);
  return users.countDocuments(staffSeatFilter(organizationId));
}

async function pendingEmployeeInviteCount(organizationId: number) {
  const invites = await getCollection(Collections.employeeInvites);
  return invites.countDocuments({
    organizationId,
    status: "pending",
    expiresAt: { $gt: new Date() },
    inviteKind: { $ne: "client" },
  });
}

export async function assertCanInviteMember(organizationId: number, actorId?: number | null) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.teamMembers == null) return;

  const active = await activeMemberCount(organizationId);
  const pending = await pendingEmployeeInviteCount(organizationId);
  if (active + pending >= limits.teamMembers) {
    await notifyPlanLimitReached(organizationId, actorId ?? null);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: PLAN_LIMIT_MESSAGE,
    });
  }
}

export async function assertCanAddMember(organizationId: number, actorId?: number | null) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.teamMembers == null) return;

  const active = await activeMemberCount(organizationId);
  if (active >= limits.teamMembers) {
    await notifyPlanLimitReached(organizationId, actorId ?? null);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: PLAN_LIMIT_MESSAGE,
    });
  }
}
