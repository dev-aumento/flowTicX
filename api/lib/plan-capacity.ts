import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import { defaultEntitlement, type PlanLimits } from "@/lib/plan-entitlements";
import { getCollection } from "../queries/connection";
import { findOrganizationById } from "./tenant";
import { findPlatformPlan } from "./platform-plans";

export async function limitsForOrganization(organizationId: number): Promise<PlanLimits | null> {
  const org = await findOrganizationById(organizationId);
  if (!org || org.workspaceType === "platform") return null;
  const slug = org.plan ?? "trial";
  const catalog = await findPlatformPlan(slug);
  return catalog?.limits ?? defaultEntitlement(slug).limits;
}

export async function assertCanAddProject(organizationId: number) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.projects == null) return;

  const projects = await getCollection(Collections.projects);
  const count = await projects.countDocuments({
    organizationId,
    status: { $nin: ["archived"] },
  });
  if (count >= limits.projects) {
    const noun = limits.projects === 1 ? "project" : "projects";
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This plan allows ${limits.projects} active ${noun}. Archive a project or upgrade the plan to add another.`,
    });
  }
}

async function activeMemberCount(organizationId: number) {
  const users = await getCollection(Collections.users);
  return users.countDocuments({
    organizationId,
    role: { $ne: "platform" },
    status: { $nin: ["inactive", "suspended"] },
  });
}

export async function assertCanInviteMember(organizationId: number) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.teamMembers == null) return;

  const active = await activeMemberCount(organizationId);
  const invites = await getCollection(Collections.employeeInvites);
  const pending = await invites.countDocuments({
    organizationId,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
  if (active + pending >= limits.teamMembers) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This plan allows up to ${limits.teamMembers} team members. Upgrade the plan to invite more people.`,
    });
  }
}

export async function assertCanAddMember(organizationId: number) {
  const limits = await limitsForOrganization(organizationId);
  if (!limits || limits.teamMembers == null) return;

  const active = await activeMemberCount(organizationId);
  if (active >= limits.teamMembers) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This plan allows up to ${limits.teamMembers} team members. Upgrade the plan to add another person.`,
    });
  }
}
