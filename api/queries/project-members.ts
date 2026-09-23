import type { ProjectMemberDoc, SafeUser } from "@db/mongo/types";
import { Collections } from "@db/mongo/collections";
import { getCollection, insertDoc } from "./mongo";

export async function findProjectMember(projectId: number, userId: number) {
  const col = await getCollection<ProjectMemberDoc>(Collections.projectMembers);
  return col.findOne({ projectId, userId });
}

export async function isProjectMember(
  projectId: number,
  userId: number,
  projectCreatedBy?: number | null,
) {
  if (projectCreatedBy != null && projectCreatedBy === userId) {
    return true;
  }
  const member = await findProjectMember(projectId, userId);
  return Boolean(member);
}

export async function joinProject(projectId: number, userId: number) {
  const existing = await findProjectMember(projectId, userId);
  if (existing) return existing;

  const now = new Date();
  return insertDoc<ProjectMemberDoc>(Collections.projectMembers, {
    projectId,
    userId,
    joinedAt: now,
  });
}

export async function getProjectMemberUserIds(projectId: number) {
  const col = await getCollection<ProjectMemberDoc>(Collections.projectMembers);
  const members = await col.find({ projectId }).toArray();
  return members.map((m) => m.userId);
}

export async function deleteProjectMembers(projectId: number) {
  const col = await getCollection<ProjectMemberDoc>(Collections.projectMembers);
  await col.deleteMany({ projectId });
}

export function canViewProjectTasks(
  user: Pick<SafeUser, "id" | "role" | "permissions">,
  projectCreatedBy: number | null | undefined,
  joined: boolean,
) {
  if (user.role === "admin" || user.role === "manager") return true;

  // Employees must explicitly join a project before seeing its tasks
  if (user.role === "employee") {
    if (projectCreatedBy != null && projectCreatedBy === user.id) return true;
    return joined;
  }

  if (user.permissions?.includes("projects.manage")) return true;
  if (user.permissions?.includes("tasks.view_all")) return true;
  if (projectCreatedBy != null && projectCreatedBy === user.id) return true;
  return joined;
}
