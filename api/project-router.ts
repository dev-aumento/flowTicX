import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { isAuthDisabled } from "./lib/dev-mode";
import * as mock from "./lib/mock-store";
import {
  getCollection,
  insertDoc,
  findById,
  updateById,
  countDocs,
  hasMongoConfigured,
} from "./queries/connection";
import {
  canViewProjectTasks,
  deleteProjectMembers,
  getProjectMemberUserIds,
  isProjectMember,
  joinProject,
} from "./queries/project-members";
import { omitPasswordHash } from "./queries/users";
import { notifyLeads } from "./lib/notify-leads";
import { assertPermission, hasAnyPermission, hasPermission } from "./lib/permissions";
import { isClientWorkspaceUser } from "./lib/client-workspace";
import { Collections } from "@db/mongo/collections";
import type { ProjectDoc, ProjectMemberDoc, TaskDoc, UserDoc } from "@db/mongo/types";
import { ensureSchema } from "./lib/migrate";
import { belongsToUserOrg, orgFilter, requireOrganizationId, resolveClientWorkspace } from "./lib/tenant";
import { assertCanAddProject, notifyIfProjectLimitReached } from "./lib/plan-capacity";
import { seedSampleWorkspaceOnce } from "./lib/sample-workspace";
import { assertPlanFeature } from "./lib/plan-guard";
import {
  attachClientToMatchedProject,
  filterClientDuplicateProjects,
  filterProjectsForInvitedClient,
  findCanonicalProjectByName,
  isInvitedStaffClient,
  listOrganizationProjects,
  loadCreatorRoles,
  loadJoinedProjectIds,
} from "./lib/client-projects";
import {
  projectPerformancePercent,
} from "@/lib/project-funnel";
import {
  createPipelineStageKey,
  nextCustomStageColor,
  resolveProjectPipelineStages,
  isPipelineStageDeletable,
  isCustomPipelineStageKey,
  movePipelineStageOrder,
  PIPELINE_STAGE_KEY_REGEX,
} from "@/lib/task-kanban";
import { resolveTenantProjectPipelineStages } from "./lib/org-task-status-labels";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type ProjectMemberUser = Pick<
  UserDoc,
  "id" | "name" | "avatar" | "department" | "position" | "role"
>;

function toListMember(user: ProjectMemberUser) {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    department: user.department ?? null,
    position: user.position ?? null,
    role: user.role ?? null,
  };
}

async function pipelineStagesFor(
  user: { organizationId?: number | null },
  project: Parameters<typeof resolveProjectPipelineStages>[0],
) {
  return resolveTenantProjectPipelineStages(requireOrganizationId(user), project);
}

async function applyProjectVisibility<
  T extends Pick<ProjectDoc, "id" | "name" | "createdBy" | "status">,
>(
  user: { id: number; role?: string | null; organizationId?: number | null },
  projects: T[],
): Promise<T[]> {
  if (await isInvitedStaffClient(user)) {
    const joinedIds = await loadJoinedProjectIds(user.id);
    return filterProjectsForInvitedClient(projects, user.id, joinedIds);
  }
  const roles = await loadCreatorRoles(projects.map((project) => project.createdBy ?? 0));
  return filterClientDuplicateProjects(projects, roles);
}

function useMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

async function assertCanCreateProject(user: Parameters<typeof isClientWorkspaceUser>[0] & Parameters<typeof hasPermission>[0]) {
  if (hasPermission(user, "projects.manage")) return;
  if (await isClientWorkspaceUser(user)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You do not have permission to create projects",
  });
}

async function assertCanManageProject(
  user: Parameters<typeof assertCanCreateProject>[0] & { id: number },
  project: Pick<ProjectDoc, "organizationId" | "createdBy">,
) {
  if (!belongsToUserOrg({ ...user, organizationId: user.organizationId ?? null }, project.organizationId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  if (hasPermission(user, "projects.manage")) return;
  if (await resolveClientWorkspace(user.organizationId)) return;
  if (await isClientWorkspaceUser(user) && project.createdBy === user.id) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You do not have permission to update this project",
  });
}

export const projectRouter = createRouter({
  list: authedQuery
    .input(
      z.object({
        status: z.string().optional(),
        search: z.string().optional(),
        /** When true, only projects the caller created or joined. */
        joinedOnly: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ input, ctx }) => {
      if (useMock()) {
        return mock.mockProjectList(ctx.user.id, {
          status: input?.status,
          joinedOnly: input?.joinedOnly,
        });
      }

      await ensureSchema();
      try {
        await seedSampleWorkspaceOnce(requireOrganizationId(ctx.user));
      } catch (error) {
        console.error("[projects] Sample projects were not created:", error);
      }
      const { status, search, joinedOnly } = input || {};

      const filter: Record<string, unknown> = { ...orgFilter(ctx.user) };
      if (status) filter.status = status;
      if (search) filter.name = new RegExp(escapeRegex(search), "i");

      const projectCol = await getCollection<ProjectDoc>(Collections.projects);
      let allProjects = await projectCol
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      if (joinedOnly) {
        const memberCol = await getCollection<{ projectId: number; userId: number }>(
          Collections.projectMembers,
        );
        const memberships = await memberCol
          .find({ userId: ctx.user.id })
          .project({ projectId: 1 })
          .toArray();
        const joinedIds = new Set(memberships.map((m) => m.projectId));
        allProjects = allProjects.filter(
          (p) => p.createdBy === ctx.user.id || joinedIds.has(p.id),
        );
      }

      allProjects = await applyProjectVisibility(ctx.user, allProjects);

      const projectIds = allProjects.map((p) => p.id);
      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const allTasks = projectIds.length > 0
        ? await taskCol.find({ projectId: { $in: projectIds }, ...orgFilter(ctx.user) }).toArray()
        : [];

      const tasksByProject = new Map<number, TaskDoc[]>();
      const memberIds = new Set<number>();

      for (const task of allTasks) {
        if (task.projectId == null) continue;
        const list = tasksByProject.get(task.projectId) ?? [];
        list.push(task);
        tasksByProject.set(task.projectId, list);
        if (task.assigneeId) memberIds.add(task.assigneeId);
        if (task.createdBy) memberIds.add(task.createdBy);
      }

      for (const project of allProjects) {
        if (project.createdBy) memberIds.add(project.createdBy);
      }

      const memberCol = await getCollection<ProjectMemberDoc>(Collections.projectMembers);
      const memberships =
        projectIds.length > 0
          ? await memberCol
              .find({ projectId: { $in: projectIds } })
              .project({ projectId: 1, userId: 1 })
              .toArray()
          : [];
      const joinedIdsByProject = new Map<number, Set<number>>();
      for (const row of memberships) {
        const set = joinedIdsByProject.get(row.projectId) ?? new Set<number>();
        set.add(row.userId);
        joinedIdsByProject.set(row.projectId, set);
        memberIds.add(row.userId);
      }

      const userCol = await getCollection<UserDoc>(Collections.users);
      const memberUsers = memberIds.size > 0
        ? await userCol
            .find({ id: { $in: [...memberIds] } })
            .project({ id: 1, name: 1, avatar: 1, department: 1, position: 1, role: 1 })
            .toArray()
        : [];
      const userMap = new Map(memberUsers.map((u) => [u.id, u]));

      return allProjects.map((project) => {
        const projectTasks = tasksByProject.get(project.id) ?? [];
        const taskCount = projectTasks.length;
        const completedCount = projectTasks.filter((t) => t.status === "done").length;

        const lastTaskUpdate = projectTasks.reduce<Date | null>((max, t) => {
          const d = new Date(t.updatedAt);
          if (Number.isNaN(d.getTime())) return max;
          return !max || d > max ? d : max;
        }, null);

        const projectMemberIds = joinedIdsByProject.get(project.id) ?? new Set<number>();
        if (project.createdBy) projectMemberIds.add(project.createdBy);
        for (const t of projectTasks) {
          if (t.assigneeId) projectMemberIds.add(t.assigneeId);
          if (t.createdBy) projectMemberIds.add(t.createdBy);
        }

        const members = [...projectMemberIds]
          .map((id) => userMap.get(id))
          .filter((u): u is ProjectMemberUser => Boolean(u))
          .map(toListMember)
          .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));

        const creatorUser = project.createdBy ? userMap.get(project.createdBy) : null;

        return {
          ...project,
          taskCount,
          completedCount,
          creator: creatorUser
            ? {
                id: creatorUser.id,
                name: creatorUser.name,
                avatar: creatorUser.avatar,
                department: creatorUser.department,
                position: creatorUser.position,
              }
            : null,
          performance: projectPerformancePercent(taskCount, completedCount),
          lastActiveAt: (lastTaskUpdate ?? project.updatedAt).toISOString(),
          members,
          privacyType: "Public" as const,
        };
      });
    }),

  /** Lightweight project picker (id/name/color/client) — avoids loading all tasks. */
  listForPicker: authedQuery.query(async ({ ctx }) => {
    if (useMock()) {
      const list = mock.mockProjectList(ctx.user.id);
      return list.map(
        (p: { id: number; name: string; color?: string | null; clientName?: string | null }) => ({
          id: p.id,
          name: p.name,
          color: p.color ?? null,
          clientName: p.clientName ?? null,
        }),
      );
    }

    await ensureSchema();
    try {
      await seedSampleWorkspaceOnce(requireOrganizationId(ctx.user));
    } catch (error) {
      console.error("[projects] Sample projects were not created:", error);
    }
    const projectCol = await getCollection<ProjectDoc>(Collections.projects);
    const projects = await projectCol
      .find(orgFilter(ctx.user))
      .project({ id: 1, name: 1, color: 1, clientName: 1, createdBy: 1, status: 1, _id: 0 })
      .sort({ name: 1 })
      .toArray() as Array<Pick<ProjectDoc, "id" | "name" | "color" | "clientName" | "createdBy" | "status">>;

    const visible = await applyProjectVisibility(ctx.user, projects);

    return visible.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color ?? null,
      clientName: p.clientName ?? null,
    }));
  }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      if (useMock()) return mock.mockProjectById(input.id, ctx.user.id);

      await ensureSchema();
      const project = await findById<ProjectDoc>(Collections.projects, input.id);
      if (!project || project.organizationId == null || !belongsToUserOrg(ctx.user, project.organizationId)) return null;

      let resolved = project;
      if (await isInvitedStaffClient(ctx.user)) {
        const orgProjects = await listOrganizationProjects(project.organizationId);
        const canonical = findCanonicalProjectByName(orgProjects, project.name, ctx.user.id);
        if (canonical) resolved = orgProjects.find((row) => row.id === canonical.id) ?? project;
        const joinedIds = await loadJoinedProjectIds(ctx.user.id);
        const visible = filterProjectsForInvitedClient(orgProjects, ctx.user.id, joinedIds);
        if (!visible.some((row) => row.id === resolved.id)) return null;
        await joinProject(resolved.id, ctx.user.id);
      }

      const joined = await isProjectMember(resolved.id, ctx.user.id, resolved.createdBy);
      const canViewTasks = canViewProjectTasks(ctx.user, resolved.createdBy, joined);

      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const [joinedMemberIds, statusGroups, hoursAgg, dueAgg, creator] = await Promise.all([
        getProjectMemberUserIds(resolved.id),
        canViewTasks
          ? taskCol
              .aggregate<{ _id: string; count: number }>([
                { $match: { projectId: resolved.id } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
              ])
              .toArray()
          : Promise.resolve([] as Array<{ _id: string; count: number }>),
        canViewTasks
          ? taskCol
              .aggregate<{ total: number }>([
                { $match: { projectId: resolved.id } },
                {
                  $group: {
                    _id: null,
                    total: {
                      $sum: {
                        $convert: {
                          input: "$actualHours",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                    },
                  },
                },
              ])
              .toArray()
          : Promise.resolve([] as Array<{ total: number }>),
        canViewTasks
          ? taskCol
              .find({ projectId: resolved.id, dueDate: { $ne: null } })
              .project({ dueDate: 1, _id: 0 })
              .sort({ dueDate: 1 })
              .limit(1)
              .toArray()
          : Promise.resolve([] as Array<{ dueDate?: Date | null }>),
        resolved.createdBy
          ? findById<UserDoc>(Collections.users, resolved.createdBy)
          : Promise.resolve(null),
      ]);

      const countByStatus = new Map(statusGroups.map((row) => [row._id, row.count]));
      const total = canViewTasks
        ? [...countByStatus.values()].reduce((sum, n) => sum + n, 0)
        : 0;
      const todo = countByStatus.get("todo") ?? 0;
      const inProgress = countByStatus.get("in_progress") ?? 0;
      const review = countByStatus.get("review") ?? 0;
      const done = countByStatus.get("done") ?? 0;
      const hoursTracked = hoursAgg[0]?.total ?? 0;
      const dueDate = dueAgg[0]?.dueDate ?? null;

      const memberIds = new Set<number>(joinedMemberIds);
      if (resolved.createdBy) memberIds.add(resolved.createdBy);

      return {
        ...resolved,
        customPipelineStages: resolved.customPipelineStages ?? [],
        pipelineStageLabelOverrides: resolved.pipelineStageLabelOverrides ?? {},
        hiddenPipelineStageKeys: resolved.hiddenPipelineStageKeys ?? [],
        pipelineStageOrder: resolved.pipelineStageOrder ?? [],
        pipelineStages: await pipelineStagesFor(ctx.user, resolved),
        creator: creator ? omitPasswordHash(creator) : null,
        stats: { total, todo, inProgress, review, done },
        hoursTracked: Math.round(hoursTracked * 10) / 10,
        memberCount: memberIds.size || 1,
        dueDate,
        isMember: joined,
        canViewTasks,
      };
    }),

  join: authedQuery
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (useMock()) return mock.mockJoinProject(input.projectId, ctx.user.id);

      assertPermission(ctx.user, "projects.view");
      await ensureSchema();

      const project = await findById<ProjectDoc>(Collections.projects, input.projectId);
      if (!project || !belongsToUserOrg(ctx.user, project.organizationId)) {
        throw new Error("Project not found");
      }

      await joinProject(input.projectId, ctx.user.id);
      const joined = await isProjectMember(input.projectId, ctx.user.id, project.createdBy);

      return {
        success: true,
        isMember: joined,
        canViewTasks: canViewProjectTasks(ctx.user, project.createdBy, joined),
      };
    }),

  create: authedQuery
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      clientName: z.string().max(200).optional(),
      color: z.string().optional(),
      icon: z.string().max(50).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertCanCreateProject(ctx.user);
      await assertPlanFeature(ctx.user, "projects");
      await ensureSchema();
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      const invitedClient = await isInvitedStaffClient(ctx.user);

      if (invitedClient) {
        const orgProjects = await listOrganizationProjects(organizationId);
        const matched = findCanonicalProjectByName(orgProjects, input.name, ctx.user.id);
        if (matched) {
          const full = await findById<ProjectDoc>(Collections.projects, matched.id);
          if (full) {
            const attached = await attachClientToMatchedProject(full, ctx.user);
            return { ...attached, creator: ctx.user, matchedExisting: true as const };
          }
        }
      }

      await assertCanAddProject(organizationId, ctx.user.id);

      const project = await insertDoc<ProjectDoc>(Collections.projects, {
        name: input.name,
        description: input.description ?? null,
        clientName: input.clientName?.trim() || (invitedClient ? ctx.user.name?.trim() || null : null),
        status: "active",
        color: input.color ?? null,
        icon: input.icon ?? null,
        organizationId,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });

      await joinProject(project.id, ctx.user.id);

      const creatorName = ctx.user.name || ctx.user.email || "Someone";
      await notifyLeads({
        actor: ctx.user,
        type: "project_created",
        title: "New project created",
        message: `${creatorName} created project "${project.name}"`,
        projectId: project.id,
      });
      await notifyIfProjectLimitReached(organizationId, ctx.user.id);

      return { ...project, creator: ctx.user };
    }),

  update: authedQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      clientName: z.string().max(200).nullable().optional(),
      status: z.enum(["active", "archived", "completed"]).optional(),
      color: z.string().optional(),
      icon: z.string().max(50).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await ensureSchema();
      const { id, ...data } = input;
      const existing = await findById<ProjectDoc>(Collections.projects, id);
      if (!existing || !belongsToUserOrg(ctx.user, existing.organizationId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      await assertCanManageProject(ctx.user, existing);
      const patch: Partial<ProjectDoc> = { updatedAt: new Date() };

      if (data.name !== undefined) patch.name = data.name;
      if (data.description !== undefined) patch.description = data.description ?? null;
      if (data.clientName !== undefined) patch.clientName = data.clientName?.trim() || null;
      if (data.status !== undefined) patch.status = data.status;
      if (data.color !== undefined) patch.color = data.color ?? null;
      if (data.icon !== undefined) patch.icon = data.icon ?? null;

      return updateById<ProjectDoc>(Collections.projects, id, patch);
    }),

  addPipelineStage: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        label: z.string().trim().min(1).max(80),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMock()) {
        return mock.mockAddPipelineStage(input.projectId, input.label, input.color);
      }

      const canAddSection =
        ctx.user.role === "manager" ||
        hasAnyPermission(ctx.user, ["projects.manage", "tasks.create", "tasks.edit_all"]);
      if (!canAddSection) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to add sections",
        });
      }
      await ensureSchema();

      const project = await findById<ProjectDoc>(Collections.projects, input.projectId);
      if (!project || !belongsToUserOrg(ctx.user, project.organizationId)) throw new Error("Project not found");

      const joined = await isProjectMember(input.projectId, ctx.user.id, project.createdBy);
      if (!canViewProjectTasks(ctx.user, project.createdBy, joined)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }

      const existing = resolveProjectPipelineStages(project);
      const key = createPipelineStageKey(
        input.label,
        existing.map((s) => s.key),
      );
      if (!PIPELINE_STAGE_KEY_REGEX.test(key)) {
        throw new Error("Could not create a valid section key");
      }

      const custom = [...(project.customPipelineStages ?? [])];
      const stage = {
        key,
        label: input.label.trim(),
        color: input.color ?? nextCustomStageColor(custom.length),
      };
      custom.push(stage);

      const currentOrder = resolveProjectPipelineStages(project).map((s) => s.key);
      const pipelineStageOrder = [...currentOrder, stage.key];

      const updated = await updateById<ProjectDoc>(Collections.projects, input.projectId, {
        customPipelineStages: custom,
        pipelineStageOrder,
        updatedAt: new Date(),
      });

      return {
        project: updated,
        stage,
        stages: await pipelineStagesFor(ctx.user, {
          ...project,
          ...updated,
          customPipelineStages: custom,
          pipelineStageOrder,
        }),
        customPipelineStages: custom,
        pipelineStageOrder,
      };
    }),

  renamePipelineStage: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        key: z.string().min(1).max(64).regex(PIPELINE_STAGE_KEY_REGEX),
        label: z.string().trim().min(1).max(80),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMock()) {
        return mock.mockRenamePipelineStage(input.projectId, input.key, input.label);
      }

      const canRename =
        ctx.user.role === "manager" ||
        hasAnyPermission(ctx.user, ["projects.manage", "tasks.create", "tasks.edit_all"]);
      if (!canRename) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to rename sections",
        });
      }
      await ensureSchema();

      const project = await findById<ProjectDoc>(Collections.projects, input.projectId);
      if (!project) throw new Error("Project not found");

      const joined = await isProjectMember(input.projectId, ctx.user.id, project.createdBy);
      if (!canViewProjectTasks(ctx.user, project.createdBy, joined)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }

      const stages = resolveProjectPipelineStages(project);
      if (!stages.some((s) => s.key === input.key)) {
        throw new Error("Section not found on this project");
      }

      const label = input.label.trim();
      const overrides = { ...(project.pipelineStageLabelOverrides ?? {}) };
      overrides[input.key] = label;

      // Keep custom stage label in sync when renaming a custom section.
      const custom = (project.customPipelineStages ?? []).map((stage) =>
        stage.key === input.key ? { ...stage, label } : stage,
      );

      const updated = await updateById<ProjectDoc>(Collections.projects, input.projectId, {
        pipelineStageLabelOverrides: overrides,
        customPipelineStages: custom,
        updatedAt: new Date(),
      });

      return {
        project: updated,
        key: input.key,
        label,
        stages: await pipelineStagesFor(ctx.user, {
          customPipelineStages: custom,
          pipelineStageLabelOverrides: overrides,
        }),
        pipelineStageLabelOverrides: overrides,
      };
    }),

  deletePipelineStage: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        key: z.string().min(1).max(64).regex(PIPELINE_STAGE_KEY_REGEX),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMock()) {
        return mock.mockDeletePipelineStage(input.projectId, input.key);
      }

      const canDelete =
        ctx.user.role === "manager" ||
        hasAnyPermission(ctx.user, ["projects.manage", "tasks.create", "tasks.edit_all"]);
      if (!canDelete) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to delete sections",
        });
      }
      await ensureSchema();

      const project = await findById<ProjectDoc>(Collections.projects, input.projectId);
      if (!project) throw new Error("Project not found");

      const joined = await isProjectMember(input.projectId, ctx.user.id, project.createdBy);
      if (!canViewProjectTasks(ctx.user, project.createdBy, joined)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }

      if (!isPipelineStageDeletable(input.key)) {
        throw new Error("To Do and Finished sections cannot be deleted");
      }

      const stages = resolveProjectPipelineStages(project);
      if (!stages.some((s) => s.key === input.key)) {
        throw new Error("Section not found on this project");
      }

      // Move tasks out of the deleted section into To Do.
      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const moveResult = await taskCol.updateMany(
        { projectId: input.projectId, stage: input.key },
        {
          $set: {
            stage: "new",
            status: "todo",
            updatedAt: new Date(),
          },
        },
      );

      const overrides = { ...(project.pipelineStageLabelOverrides ?? {}) };
      delete overrides[input.key];

      let custom = [...(project.customPipelineStages ?? [])];
      let hidden = [...(project.hiddenPipelineStageKeys ?? [])];

      if (isCustomPipelineStageKey(input.key)) {
        custom = custom.filter((stage) => stage.key !== input.key);
      } else if (!hidden.includes(input.key)) {
        hidden.push(input.key);
      }

      const updated = await updateById<ProjectDoc>(Collections.projects, input.projectId, {
        customPipelineStages: custom,
        pipelineStageLabelOverrides: overrides,
        hiddenPipelineStageKeys: hidden,
        pipelineStageOrder: (project.pipelineStageOrder ?? []).filter((k) => k !== input.key),
        updatedAt: new Date(),
      });

      const nextStages = await pipelineStagesFor(ctx.user, {
        customPipelineStages: custom,
        pipelineStageLabelOverrides: overrides,
        hiddenPipelineStageKeys: hidden,
        pipelineStageOrder: updated?.pipelineStageOrder ?? null,
      });

      return {
        project: updated,
        key: input.key,
        movedTaskCount: moveResult.modifiedCount,
        stages: nextStages,
        customPipelineStages: custom,
        pipelineStageLabelOverrides: overrides,
        hiddenPipelineStageKeys: hidden,
        pipelineStageOrder: updated?.pipelineStageOrder ?? [],
      };
    }),

  reorderPipelineStage: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        key: z.string().min(1).max(64).regex(PIPELINE_STAGE_KEY_REGEX),
        direction: z.enum(["left", "right"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useMock()) {
        return mock.mockReorderPipelineStage(input.projectId, input.key, input.direction);
      }

      const canReorder =
        ctx.user.role === "manager" ||
        hasAnyPermission(ctx.user, ["projects.manage", "tasks.create", "tasks.edit_all"]);
      if (!canReorder) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to reorder sections",
        });
      }
      await ensureSchema();

      const project = await findById<ProjectDoc>(Collections.projects, input.projectId);
      if (!project) throw new Error("Project not found");

      const joined = await isProjectMember(input.projectId, ctx.user.id, project.createdBy);
      if (!canViewProjectTasks(ctx.user, project.createdBy, joined)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }

      const stages = resolveProjectPipelineStages(project);
      if (!stages.some((s) => s.key === input.key)) {
        throw new Error("Section not found on this project");
      }

      const pipelineStageOrder = movePipelineStageOrder(
        stages.map((s) => s.key),
        input.key,
        input.direction,
      );
      if (!pipelineStageOrder) {
        return {
          project,
          key: input.key,
          direction: input.direction,
          stages,
          pipelineStageOrder: project.pipelineStageOrder ?? stages.map((s) => s.key),
        };
      }

      const updated = await updateById<ProjectDoc>(Collections.projects, input.projectId, {
        pipelineStageOrder,
        updatedAt: new Date(),
      });

      const nextStages = await pipelineStagesFor(ctx.user, {
        ...project,
        ...updated,
        pipelineStageOrder,
      });

      return {
        project: updated,
        key: input.key,
        direction: input.direction,
        stages: nextStages,
        pipelineStageOrder,
      };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (useMock()) return mock.mockDeleteProject(input.id);

      assertPermission(ctx.user, "projects.manage");
      await ensureSchema();

      const project = await findById<ProjectDoc>(Collections.projects, input.id);
      if (!project) {
        throw new Error("Project not found");
      }

      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const projectTasks = await taskCol.find({ projectId: input.id }).toArray();
      const taskIds = projectTasks.map((t) => t.id);

      if (taskIds.length > 0) {
        const taskFilter = { taskId: { $in: taskIds } };
        await Promise.all([
          getCollection(Collections.taskParticipants).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.subtasks).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.taskActivity).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.taskAttachments).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.taskTagRelations).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.timeEntries).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.notifications).then((c) => c.deleteMany({ taskId: { $in: taskIds } })),
        ]);
        await taskCol.deleteMany({ id: { $in: taskIds } });
      }

      await getCollection(Collections.notifications).then((c) =>
        c.deleteMany({ projectId: input.id }),
      );

      await deleteProjectMembers(input.id);

      const projectCol = await getCollection<ProjectDoc>(Collections.projects);
      await projectCol.deleteOne({ id: input.id });

      return { success: true };
    }),
});
