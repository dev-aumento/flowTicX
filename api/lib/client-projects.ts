import { Collections } from "@db/mongo/collections";
import type { ProjectDoc, UserDoc } from "@db/mongo/types";
import { getCollection, updateById } from "../queries/connection";
import { isProjectMember, joinProject } from "../queries/project-members";
import { resolveClientWorkspace } from "./tenant";

export function normalizeProjectName(name: string | null | undefined) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export async function isInvitedStaffClient(user: {
  role?: string | null;
  organizationId?: number | null;
}) {
  if (String(user.role ?? "").toLowerCase() !== "client") return false;
  if (user.organizationId == null || user.organizationId <= 0) return true;
  return !(await resolveClientWorkspace(user.organizationId));
}

function isClientCreator(
  createdBy: number | null | undefined,
  rolesByUserId: Map<number, string | null | undefined>,
) {
  if (createdBy == null) return false;
  return String(rolesByUserId.get(createdBy) ?? "").toLowerCase() === "client";
}

export async function loadCreatorRoles(userIds: number[]) {
  const ids = [...new Set(userIds.filter((id) => id > 0))];
  const roles = new Map<number, string | null | undefined>();
  if (ids.length === 0) return roles;
  const userCol = await getCollection<UserDoc>(Collections.users);
  const users = await userCol
    .find({ id: { $in: ids } }, { projection: { id: 1, role: 1 } })
    .toArray();
  for (const user of users) roles.set(user.id, user.role);
  return roles;
}

/** Prefer the staff-owned project when the same name already exists in the org. */
export function findCanonicalProjectByName<T extends Pick<ProjectDoc, "id" | "name" | "createdBy" | "status">>(
  projects: T[],
  name: string,
  clientUserId: number,
) {
  const key = normalizeProjectName(name);
  if (!key) return null;
  const matches = projects.filter((project) => normalizeProjectName(project.name) === key);
  if (matches.length === 0) return null;

  const staffOwned = matches
    .filter((project) => project.createdBy !== clientUserId)
    .sort((a, b) => a.id - b.id);
  const activeStaff = staffOwned.filter((project) => String(project.status ?? "") !== "archived");
  if (activeStaff.length > 0) return activeStaff[0];
  if (staffOwned.length > 0) return staffOwned[0];

  return [...matches].sort((a, b) => a.id - b.id)[0];
}

export function filterProjectsForInvitedClient<T extends Pick<ProjectDoc, "id" | "name" | "createdBy" | "status">>(
  projects: T[],
  clientUserId: number,
  joinedIds: Set<number> = new Set(),
) {
  const mine = projects.filter((project) => project.createdBy === clientUserId);
  const claimedNames = new Set(mine.map((project) => normalizeProjectName(project.name)));
  const visible: T[] = [];
  const shownNames = new Set<string>();

  for (const project of projects) {
    const key = normalizeProjectName(project.name);
    if (!key) continue;

    if (project.createdBy === clientUserId) {
      const canonical = findCanonicalProjectByName(projects, project.name, clientUserId);
      if (canonical && canonical.id !== project.id) continue;
      visible.push(project);
      shownNames.add(key);
      continue;
    }

    const claimed = claimedNames.has(key) || joinedIds.has(project.id);
    if (!claimed || shownNames.has(key)) continue;
    const canonical = findCanonicalProjectByName(projects, project.name, clientUserId);
    if (!canonical || canonical.id !== project.id) continue;
    visible.push(project);
    shownNames.add(key);
  }

  return visible;
}

/** Staff CRM hides a client copy when a staff-owned project already has that name. */
export function filterClientDuplicateProjects<T extends Pick<ProjectDoc, "id" | "name" | "createdBy">>(
  projects: T[],
  rolesByUserId: Map<number, string | null | undefined>,
) {
  const staffNames = new Set(
    projects
      .filter((project) => !isClientCreator(project.createdBy, rolesByUserId))
      .map((project) => normalizeProjectName(project.name)),
  );

  return projects.filter((project) => {
    if (!isClientCreator(project.createdBy, rolesByUserId)) return true;
    const key = normalizeProjectName(project.name);
    return !key || !staffNames.has(key);
  });
}

export async function listOrganizationProjects(organizationId: number) {
  const col = await getCollection<ProjectDoc>(Collections.projects);
  return col.find({ organizationId }).toArray();
}

export async function loadJoinedProjectIds(userId: number) {
  const col = await getCollection<{ projectId: number }>(Collections.projectMembers);
  const rows = await col.find({ userId }, { projection: { projectId: 1 } }).toArray();
  return new Set(rows.map((row) => row.projectId));
}

export async function resolveProjectForInvitedClientTask(
  organizationId: number,
  project: Pick<ProjectDoc, "id" | "name" | "createdBy" | "status">,
  clientUserId: number,
) {
  const projects = await listOrganizationProjects(organizationId);
  const canonical = findCanonicalProjectByName(projects, project.name, clientUserId) ?? project;
  const claimedName = projects.some(
    (row) =>
      row.createdBy === clientUserId &&
      normalizeProjectName(row.name) === normalizeProjectName(project.name),
  );
  const createdThis = project.createdBy === clientUserId || canonical.createdBy === clientUserId;
  const isMember = await isProjectMember(canonical.id, clientUserId, canonical.createdBy);

  if (!claimedName && !createdThis && !isMember) return null;

  await joinProject(canonical.id, clientUserId);
  return canonical;
}

export async function attachClientToMatchedProject(
  project: ProjectDoc,
  client: { id: number; name?: string | null },
) {
  await joinProject(project.id, client.id);
  const label = client.name?.trim();
  if (label && !project.clientName?.trim()) {
    const updated = await updateById<ProjectDoc>(Collections.projects, project.id, {
      clientName: label,
      updatedAt: new Date(),
    });
    return updated ?? { ...project, clientName: label };
  }
  return project;
}
