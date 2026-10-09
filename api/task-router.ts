import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { assertPlanFeature } from "./lib/plan-guard";
import { isAuthDisabled } from "./lib/dev-mode";
import * as mock from "./lib/mock-store";
import { ensureSchema } from "./lib/migrate";
import {
  getCollection,
  insertDoc,
  findById,
  updateById,
  countDocs,
  hasMongoConfigured,
  ensureOrgDisplayNumbers,
} from "./queries/connection";
import {
  deleteAttachmentFromGridFs,
  downloadAttachmentFromGridFs,
  uploadAttachmentToGridFs,
} from "./queries/attachment-storage";
import { omitPasswordHash } from "./queries/users";
import { notifyLeads } from "./lib/notify-leads";
import { notifyTaskMembers, notifyTaskStakeholders } from "./lib/notify-task-members";
import { assertPermission, assertCanChangeTaskAssignee, assertAnyPermission, hasPermission, canViewClientTasks } from "./lib/permissions";
import { isProjectMember, canViewProjectTasks } from "./queries/project-members";
import { defaultTaskDeadlineIso, formatDueLabel } from "@/lib/task-deadline";
import { Collections } from "@db/mongo/collections";
import type {
  UserDoc,
  TaskDoc,
  SubtaskDoc,
  TaskParticipantDoc,
  TaskActivityDoc,
  ProjectDoc,
  TimeEntryDoc,
  TaskAttachmentDoc,
  NotificationDoc,
  SafeUser,
} from "@db/mongo/types";
import { PIPELINE_STAGE_KEY_REGEX, legacyStatusToStage, isCompletedTask, isMarkingTaskComplete } from "@/lib/task-kanban";
import { extractMentionedUserIds, formatCommentPreview } from "@/lib/task-comment-mentions";
import { extractMentionedUserIdsFromComment, richCommentPlainText } from "@/lib/rich-comment";
import { parseMeetingComment } from "@/lib/workspace-meetings";
import { readCommentReactions, toggleUserReaction } from "@/lib/comment-reactions";
import { pauseOtherRunningTaskTimers } from "./lib/task-timers";
import { belongsToUserOrg, orgFilter, requireOrganizationId } from "./lib/tenant";
import { resolveTenantProjectPipelineStages } from "./lib/org-task-status-labels";
import { isInvitedStaffClient, resolveProjectForInvitedClientTask } from "./lib/client-projects";
import {
  assertInvitedClientAssigneeAllowed,
  assertTaskAssigneeAllowed,
  invitedClientMayViewDueDate,
  invitedClientMayViewTimeTracking,
  isClientCreatedTask,
  redactTaskForClient,
} from "./lib/client-visibility";
import { isTaskAssignableUser } from "@/lib/leave-policy";
import { extractTaskTags } from "@/lib/task-tags";

/** Comment reactions are stored on activity.metadata.reactions */
const projectStageSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(PIPELINE_STAGE_KEY_REGEX, "Invalid pipeline stage key");

function useTaskMock() {
  return isAuthDisabled() || !hasMongoConfigured();
}

function actorLabel(user: SafeUser) {
  return user.name || user.email || "Someone";
}

async function isTaskParticipant(taskId: number, userId: number): Promise<boolean> {
  const participantCol = await getCollection<TaskParticipantDoc>(Collections.taskParticipants);
  const row = await participantCol.findOne({
    taskId: Number(taskId),
    userId: Number(userId),
    role: "participant",
  });
  return !!row;
}

function sameUserId(a?: number | null, b?: number | null) {
  return a != null && b != null && Number(a) === Number(b);
}

/** Assignee, owner, participant, manager/admin, or granted edit permissions. */
async function canManageTaskTime(user: SafeUser, task: TaskDoc): Promise<boolean> {
  if (
    hasPermission(user, "time.edit_all") ||
    hasPermission(user, "tasks.edit_all")
  ) {
    return true;
  }
  if (
    user.role === "admin"
    || user.role === "manager"
    || sameUserId(task.createdBy, user.id)
    || sameUserId(task.assigneeId, user.id)
  ) {
    return true;
  }
  return isTaskParticipant(task.id, user.id);
}

function isStaffAssigneeUser(user: { role?: string | null; department?: string | null }) {
  const role = String(user.role ?? "").toLowerCase();
  if (role === "client" || role === "platform") return false;
  return isTaskAssignableUser(user);
}

async function assertTaskMemberAllowed(userId: number | null | undefined) {
  if (userId == null) return;
  if (useTaskMock()) {
    const found = mock.mockUserList().users.find((user) => user.id === userId);
    if (!found) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "User not found" });
    }
    if (!isTaskAssignableUser(found)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "HR and finance users cannot be added as assignees, participants, or observers",
      });
    }
    return;
  }
  await assertTaskAssigneeAllowed(userId);
}

/** Invited clients live in a staff CRM org, not a standalone client portal. */
async function isInvitedClientUser(user: { role?: string | null; organizationId?: number | null }) {
  return isInvitedStaffClient(user);
}

async function canViewTask(user: SafeUser, task: Pick<TaskDoc, "organizationId" | "assigneeId">) {
  return belongsToUserOrg(user, task.organizationId);
}

async function clientFieldVisibility(user: SafeUser) {
  const [canDue, canTime] = await Promise.all([
    invitedClientMayViewDueDate(user),
    invitedClientMayViewTimeTracking(user),
  ]);
  return {
    hideDueDate: !canDue,
    hideTimeTracking: !canTime,
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function canEditTaskTimeEntry(
  user: SafeUser,
  task: TaskDoc,
  entry: TimeEntryDoc,
): Promise<boolean> {
  // Owners can always edit/delete their own completed entries.
  if (sameUserId(entry.userId, user.id)) return true;
  return canManageTaskTime(user, task);
}

async function findUsersByIds(ids: number[]): Promise<Map<number, SafeUser>> {
  if (ids.length === 0) return new Map();
  const col = await getCollection<UserDoc>(Collections.users);
  const users = await col.find({ id: { $in: ids } }).toArray();
  return new Map(users.map((u) => [u.id, omitPasswordHash(u)]));
}

function attachmentMeta(doc: TaskAttachmentDoc) {
  const { dataBase64: _data, gridFsId: _grid, ...meta } = doc;
  return meta;
}

/** Files section / task.attachments: exclude comment-only media. */
const LISTED_IN_FILES_FILTER = {
  $or: [{ listedInFiles: { $exists: false } }, { listedInFiles: true }],
};

export const taskRouter = createRouter({
  list: authedQuery
    .input(
      z.object({
        status: z.string().optional(),
        priority: z.string().optional(),
        assigneeId: z.number().optional(),
        projectId: z.number().nullable().optional(),
        search: z.string().optional(),
        page: z.number().default(1),
        limit: z.number().default(50),
        /** Tasks created by a client user in this org (staff, client, or unassigned). */
        clientAssignedToStaff: z.boolean().optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      if (input?.clientAssignedToStaff && !canViewClientTasks(ctx.user)) {
        return { tasks: [], total: 0 };
      }
      if (useTaskMock()) return mock.mockTaskList(input || undefined, ctx.user);

      await ensureSchema();
      await ensureOrgDisplayNumbers(Collections.tasks, requireOrganizationId(ctx.user));
      const {
        status,
        priority,
        assigneeId,
        projectId,
        search,
        page = 1,
        limit = 50,
        clientAssignedToStaff,
      } = input || {};

      if (projectId != null) {
        const project = await findById<ProjectDoc>(Collections.projects, projectId);
        if (!project || !belongsToUserOrg(ctx.user, project.organizationId)) {
          return { tasks: [], total: 0 };
        }

        const joined = await isProjectMember(projectId, ctx.user.id, project.createdBy);
        if (!canViewProjectTasks(ctx.user, project.createdBy, joined)) {
          return { tasks: [], total: 0 };
        }
      }

      const skip = (page - 1) * limit;

      const filter: Record<string, unknown> = { ...orgFilter(ctx.user) };
      if (status) filter.status = status;
      if (priority) filter.priority = priority;
      if (assigneeId) filter.assigneeId = assigneeId;
      if (projectId !== undefined && projectId !== null) filter.projectId = projectId;
      if (search) filter.title = new RegExp(escapeRegex(search), "i");

      if (clientAssignedToStaff) {
        const usersCol = await getCollection<UserDoc>(Collections.users);
        const orgUsers = await usersCol
          .find(orgFilter(ctx.user), { projection: { id: 1, role: 1, department: 1 } })
          .toArray();
        const clientIds = orgUsers
          .filter((user) => String(user.role ?? "").toLowerCase() === "client")
          .map((user) => user.id);
        const staffIds = orgUsers
          .filter((user) => isStaffAssigneeUser(user))
          .map((user) => user.id);
        if (clientIds.length === 0) {
          return { tasks: [], total: 0 };
        }
        const assigneePool = [...staffIds, ...clientIds];
        if (assigneeId && !assigneePool.includes(assigneeId)) {
          return { tasks: [], total: 0 };
        }

        const activityCol = await getCollection<TaskActivityDoc>(Collections.taskActivity);
        const originated = await activityCol
          .find(
            { action: "created", userId: { $in: clientIds } },
            { projection: { taskId: 1 } },
          )
          .toArray();
        const originatedTaskIds = [...new Set(originated.map((row) => row.taskId).filter((id) => id > 0))];

        // Keep finished (unassigned) and client-assigned tasks on Client's Tasks
        // so staff can hand completed work back to the client.
        filter.assigneeId = assigneeId
          ? assigneeId
          : { $in: [...assigneePool, null] };
        if (originatedTaskIds.length > 0) {
          filter.$or = [
            { createdBy: { $in: clientIds } },
            { id: { $in: originatedTaskIds } },
          ];
        } else {
          filter.createdBy = { $in: clientIds };
        }
      } else if (
        String(ctx.user.role ?? "").toLowerCase() === "client" &&
        !hasPermission(ctx.user, "tasks.view_all")
      ) {
        const participantCol = await getCollection<TaskParticipantDoc>(Collections.taskParticipants);
        const related = await participantCol
          .find({ userId: ctx.user.id }, { projection: { taskId: 1 } })
          .toArray();
        const relatedIds = related.map((row) => row.taskId);
        filter.$or = [
          { createdBy: ctx.user.id },
          { assigneeId: ctx.user.id },
          ...(relatedIds.length > 0 ? [{ id: { $in: relatedIds } }] : []),
        ];
      }

      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const [allTasks, total] = await Promise.all([
        taskCol.find(filter).sort({ position: 1, createdAt: -1 }).skip(skip).limit(limit).toArray(),
        countDocs(Collections.tasks, filter),
      ]);

      const taskIds = allTasks.map((t) => t.id);
      const participantCol = await getCollection<TaskParticipantDoc>(Collections.taskParticipants);
      const subtaskCol = await getCollection<SubtaskDoc>(Collections.subtasks);
      const [allParticipants, subtaskRows] = await Promise.all([
        taskIds.length > 0
          ? participantCol.find({ taskId: { $in: taskIds } }).toArray()
          : Promise.resolve([]),
        taskIds.length > 0
          ? subtaskCol
              .find({ taskId: { $in: taskIds } }, { projection: { taskId: 1, completed: 1 } })
              .toArray()
          : Promise.resolve([]),
      ]);
      const subtaskStats = new Map<number, { total: number; completed: number }>();
      for (const row of subtaskRows) {
        const current = subtaskStats.get(row.taskId) ?? { total: 0, completed: 0 };
        current.total += 1;
        if (row.completed) current.completed += 1;
        subtaskStats.set(row.taskId, current);
      }

      const assigneeIds = allTasks
        .map((t) => t.assigneeId)
        .filter((id): id is number => id != null);
      const creatorIds = allTasks
        .map((t) => t.createdBy)
        .filter((id): id is number => id != null);
      const userIds = [...new Set([...assigneeIds, ...creatorIds])];
      const userMap = await findUsersByIds(userIds);

      const projectIds = [
        ...new Set(
          allTasks
            .map((t) => t.projectId)
            .filter((id): id is number => id != null),
        ),
      ];
      const projectCol = await getCollection<ProjectDoc>(Collections.projects);
      const projectDocs =
        projectIds.length > 0
          ? await projectCol
              .find({ id: { $in: projectIds } })
              .project({ id: 1, name: 1, color: 1, clientName: 1 })
              .toArray()
          : [];
      const projectMap = new Map(projectDocs.map((p) => [p.id, p]));

      const visibility = await clientFieldVisibility(ctx.user);
      const tasksWithAssignees = allTasks.map((task) => {
        const stats = subtaskStats.get(task.id);
        return redactTaskForClient(
          {
            ...task,
            assignee: task.assigneeId ? userMap.get(task.assigneeId) ?? null : null,
            creator: task.createdBy ? userMap.get(task.createdBy) ?? null : null,
            project: task.projectId
              ? projectMap.get(task.projectId) ?? null
              : null,
            participantIds: allParticipants
              .filter((p) => p.taskId === task.id && p.role === "participant")
              .map((p) => p.userId),
            observerIds: allParticipants
              .filter((p) => p.taskId === task.id && p.role === "observer")
              .map((p) => p.userId),
            tags: extractTaskTags(task),
            subtaskCount: stats?.total ?? 0,
            completedSubtaskCount: stats?.completed ?? 0,
          },
          visibility,
        );
      });

      return { tasks: tasksWithAssignees, total };
    }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      if (useTaskMock()) return mock.mockTaskById(input.id);

      await ensureSchema();
      await ensureOrgDisplayNumbers(Collections.tasks, requireOrganizationId(ctx.user));
      const task = await findById<TaskDoc>(Collections.tasks, input.id);
      if (!task || !(await canViewTask(ctx.user, task))) return null;

      const subtaskCol = await getCollection<SubtaskDoc>(Collections.subtasks);
      const participantCol = await getCollection<TaskParticipantDoc>(Collections.taskParticipants);
      const activityCol = await getCollection<TaskActivityDoc>(Collections.taskActivity);
      const attachmentCol = await getCollection<TaskAttachmentDoc>(Collections.taskAttachments);

      const ATTACHMENT_META_PROJECTION = {
        dataBase64: 0,
        gridFsId: 0,
      } as const;
      const ACTIVITY_LIMIT = 80;

      const [subtasksList, participants, activities, attachmentsList] = await Promise.all([
        subtaskCol.find({ taskId: task.id }).sort({ position: 1 }).toArray(),
        participantCol.find({ taskId: task.id }).toArray(),
        activityCol
          .find({ taskId: task.id })
          .sort({ createdAt: -1 })
          .limit(ACTIVITY_LIMIT)
          .toArray(),
        attachmentCol
          .find({ taskId: task.id, ...LISTED_IN_FILES_FILTER })
          .project(ATTACHMENT_META_PROJECTION)
          .sort({ createdAt: -1 })
          .toArray(),
      ]);

      const userIds = new Set<number>();
      if (task.assigneeId) userIds.add(task.assigneeId);
      if (task.createdBy) userIds.add(task.createdBy);
      for (const p of participants) userIds.add(p.userId);
      for (const a of activities) {
        if (a.userId) userIds.add(a.userId);
      }

      const [userMap, project] = await Promise.all([
        findUsersByIds([...userIds]),
        task.projectId
          ? findById<ProjectDoc>(Collections.projects, task.projectId)
          : Promise.resolve(null),
      ]);

      const participantUsers = participants
        .filter((p) => p.role === "participant")
        .map((p) => userMap.get(p.userId))
        .filter((u): u is SafeUser => u != null);

      const observerUsers = participants
        .filter((p) => p.role === "observer")
        .map((p) => userMap.get(p.userId))
        .filter((u): u is SafeUser => u != null);

      return redactTaskForClient(
        {
          ...task,
          assignee: task.assigneeId ? userMap.get(task.assigneeId) ?? null : null,
          creator: task.createdBy ? userMap.get(task.createdBy) ?? null : null,
          project: project
            ? {
                ...project,
                customPipelineStages: project.customPipelineStages ?? [],
                pipelineStageLabelOverrides: project.pipelineStageLabelOverrides ?? {},
              }
            : null,
          pipelineStages: await resolveTenantProjectPipelineStages(
            requireOrganizationId(ctx.user),
            project,
          ),
          subtasks: subtasksList,
          attachments: attachmentsList.map(attachmentMeta),
          participants: participantUsers,
          observers: observerUsers,
          activities: activities.map((a) => ({
            ...a,
            user: a.userId ? userMap.get(a.userId) ?? null : null,
          })),
        },
        await clientFieldVisibility(ctx.user),
      );
    }),

  getTimeTracked: authedQuery
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input, ctx }) => {
      if (!(await invitedClientMayViewTimeTracking(ctx.user))) {
        return { totalMinutes: 0, totalSeconds: 0, entries: [] };
      }
      if (useTaskMock()) return mock.mockTaskTimeTracked(input.taskId);

      await ensureSchema();
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entries = await timeCol
        .find({ taskId: input.taskId })
        .sort({ clockIn: -1 })
        .toArray();

      const userIds = [...new Set(entries.map((e) => e.userId))];
      const userMap = await findUsersByIds(userIds);

      const totalSeconds = entries.reduce((sum, e) => {
        // Only completed sessions count toward the task total.
        if (!e.clockIn || !e.clockOut) return sum;
        if (typeof e.durationSeconds === "number" && e.durationSeconds >= 0) {
          return sum + e.durationSeconds;
        }
        return sum + Math.max(0, Math.floor((e.clockOut.getTime() - e.clockIn.getTime()) / 1000));
      }, 0);

      return {
        totalMinutes: Math.round(totalSeconds / 60),
        totalSeconds,
        entries: entries
          .filter((e) => e.clockIn && e.clockOut)
          .map((e) => ({
            ...e,
            user: userMap.get(e.userId) ?? null,
            durationSeconds:
              typeof e.durationSeconds === "number" && e.durationSeconds >= 0
                ? e.durationSeconds
                : Math.max(0, Math.floor((e.clockOut!.getTime() - e.clockIn!.getTime()) / 1000)),
          })),
      };
    }),

  create: authedQuery
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      assigneeId: z.number().optional(),
      /** Initial task owner. Defaults to the creating user. */
      createdBy: z.number().optional(),
      projectId: z.number().nullable().optional(),
      dueDate: z.string().optional(),
      estimatedHours: z.number().nullable().optional(),
      tags: z.array(z.string()).optional(),
      stage: projectStageSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertPlanFeature(ctx.user, "tasks");
      assertPermission(ctx.user, "tasks.create");

      await assertTaskMemberAllowed(input.assigneeId ?? null);
      if (useTaskMock()) {
        return mock.mockCreateTask(input, ctx.user);
      }

      await ensureSchema();
      const { tags, createdBy: ownerId, ...taskData } = input;
      const now = new Date();
      const organizationId = requireOrganizationId(ctx.user);
      let createdBy = ownerId != null ? Number(ownerId) : ctx.user.id;
      if (await isInvitedClientUser(ctx.user)) {
        createdBy = ctx.user.id;
      }
      await assertInvitedClientAssigneeAllowed(ctx.user, taskData.assigneeId ?? null);

      let projectId = taskData.projectId ?? null;
      if (projectId != null) {
        const project = await findById<ProjectDoc>(Collections.projects, projectId);
        if (!project || !belongsToUserOrg(ctx.user, project.organizationId)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }
        if (await isInvitedStaffClient(ctx.user)) {
          const resolved = await resolveProjectForInvitedClientTask(
            organizationId,
            project,
            ctx.user.id,
          );
          if (!resolved) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
          }
          projectId = resolved.id;
        }
      }

      const newTask = await insertDoc<TaskDoc>(Collections.tasks, {
        title: taskData.title,
        description: taskData.description ?? null,
        status: "todo",
        stage: taskData.stage ?? "new",
        priority: taskData.priority ?? "medium",
        assigneeId: taskData.assigneeId ?? null,
        projectId,
        organizationId,
        createdBy,
        dueDate: taskData.dueDate
          ? new Date(taskData.dueDate)
          : new Date(defaultTaskDeadlineIso()),
        estimatedHours: taskData.estimatedHours != null ? String(taskData.estimatedHours) : null,
        actualHours: null,
        position: 0,
        createdAt: now,
        updatedAt: now,
      });

      await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: newTask.id,
        userId: ctx.user.id,
        action: "created",
        oldValue: null,
        newValue: taskData.title,
        metadata: tags?.length ? { tags } : null,
        createdAt: now,
      });

      if (taskData.assigneeId && taskData.assigneeId !== ctx.user.id) {
        await notifyTaskMembers({
          taskId: newTask.id,
          actor: ctx.user,
          type: "task_assigned",
          title: "Assigned to you",
          message: `${actorLabel(ctx.user)} assigned "${taskData.title}" to you`,
          extraRecipientIds: [taskData.assigneeId],
          includeAssignee: false,
          includeOwner: false,
        });
      }

      const creatorName = ctx.user.name || ctx.user.email || "Someone";
      await notifyLeads({
        actor: ctx.user,
        type: "task_created",
        title: "New task created",
        message: `${creatorName} created "${taskData.title}"`,
        taskId: newTask.id,
        excludeUserIds: taskData.assigneeId ? [taskData.assigneeId] : [],
      });

      return { ...newTask, creator: ctx.user };
    }),

  update: authedQuery
    .input(z.object({
      id: z.number(),
      title: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
      stage: projectStageSchema.optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      assigneeId: z.number().nullable().optional(),
      createdBy: z.number().nullable().optional(),
      projectId: z.number().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      estimatedHours: z.number().nullable().optional(),
      actualHours: z.number().optional(),
      position: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (useTaskMock()) {
        const { id, ...data } = input;
        const existing = mock.mockTaskById(id);
        if (!existing) throw new Error("Task not found");
        if (data.assigneeId !== undefined) {
          await assertTaskMemberAllowed(data.assigneeId);
          assertCanChangeTaskAssignee(
            ctx.user,
            existing.assigneeId,
            data.assigneeId,
          );
        }
        if (data.createdBy !== undefined) {
          const nextOwnerId = data.createdBy == null ? null : Number(data.createdBy);
          const ownerChanged =
            nextOwnerId !== (existing.createdBy == null ? null : Number(existing.createdBy));
          if (ownerChanged) {
            if (
              await isInvitedClientUser(ctx.user) ||
              String(existing.creator?.role ?? "").toLowerCase() === "client"
            ) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "The owner of a client task cannot be changed",
              });
            }
            const canChangeOwner =
              ctx.user.role === "admin" ||
              ctx.user.role === "manager" ||
              hasPermission(ctx.user, "tasks.edit_all");
            if (!canChangeOwner) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to change the task owner",
              });
            }
          }
        }
        const updated = mock.mockUpdateTask(id, data, ctx.user);
        if (!updated) throw new Error("Task not found");
        return updated;
      }

      await ensureSchema();
      const { id, ...data } = input;

      const oldTask = await findById<TaskDoc>(Collections.tasks, id);
      if (!oldTask) throw new Error("Task not found");

      if (data.assigneeId !== undefined) {
        assertCanChangeTaskAssignee(ctx.user, oldTask.assigneeId, data.assigneeId);
        await assertTaskMemberAllowed(data.assigneeId);
        await assertInvitedClientAssigneeAllowed(ctx.user, data.assigneeId);
      }

      const patch: Partial<TaskDoc> = { updatedAt: new Date() };
      if (data.title !== undefined) patch.title = data.title;
      if (data.description !== undefined) patch.description = data.description;
      if (data.status !== undefined) {
        patch.status = data.status;
        // Keep pipeline stage aligned with status when stage isn't sent separately
        // (bulk / list status changes), so Task Detail doesn't keep an old stage label.
        if (data.stage === undefined) {
          patch.stage = legacyStatusToStage(data.status);
        }
      }
      if (data.priority !== undefined) patch.priority = data.priority;
      if (data.assigneeId !== undefined) patch.assigneeId = data.assigneeId;
      if (data.projectId !== undefined) {
        if (data.projectId != null && (await isInvitedStaffClient(ctx.user))) {
          const project = await findById<ProjectDoc>(Collections.projects, data.projectId);
          if (!project || !belongsToUserOrg(ctx.user, project.organizationId)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
          }
          const resolved = await resolveProjectForInvitedClientTask(
            requireOrganizationId(ctx.user),
            project,
            ctx.user.id,
          );
          if (!resolved) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
          }
          patch.projectId = resolved.id;
        } else {
          patch.projectId = data.projectId;
        }
      }
      if (data.position !== undefined) patch.position = data.position;
      if (data.dueDate !== undefined && (await invitedClientMayViewDueDate(ctx.user))) {
        patch.dueDate = data.dueDate ? new Date(data.dueDate) : null;
      }
      if (data.estimatedHours !== undefined && (await invitedClientMayViewTimeTracking(ctx.user))) {
        patch.estimatedHours = data.estimatedHours != null ? String(data.estimatedHours) : null;
      }
      if (data.actualHours !== undefined && (await invitedClientMayViewTimeTracking(ctx.user))) {
        patch.actualHours = String(data.actualHours);
      }
      if (data.createdBy !== undefined) {
        const nextOwnerId = data.createdBy == null ? null : Number(data.createdBy);
        const ownerChanged = nextOwnerId !== (oldTask.createdBy == null ? null : Number(oldTask.createdBy));
        if (ownerChanged) {
          if (await isInvitedClientUser(ctx.user) || (await isClientCreatedTask(oldTask))) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "The owner of a client task cannot be changed",
            });
          }
          const canChangeOwner =
            ctx.user.role === "admin" ||
            ctx.user.role === "manager" ||
            hasPermission(ctx.user, "tasks.edit_all");
          if (!canChangeOwner) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have permission to change the task owner",
            });
          }
          patch.createdBy = nextOwnerId;
        }
      }

      if (data.stage) {
        patch.stage = data.stage;
        if (data.stage === "finished") {
          patch.status = "done";
        } else if (oldTask.status === "done") {
          patch.status = "in_progress";
        }
      }

      // Completing a task (Done / Finished) always clears the assignee.
      // Due-date changes / overdue reminders must never clear the assignee or stop timers.
      const clearingAssigneeOnComplete =
        isMarkingTaskComplete(data) && oldTask.assigneeId != null;
      if (isMarkingTaskComplete(data)) {
        patch.assigneeId = null;
      }

      const updated = await updateById<TaskDoc>(Collections.tasks, id, patch);
      if (!updated) throw new Error("Task not found");

      const now = new Date();
      const label = actorLabel(ctx.user);
      const taskTitle = patch.title ?? oldTask.title;
      const markingComplete = isMarkingTaskComplete(data) && !isCompletedTask(oldTask);

      if (data.title !== undefined && data.title !== oldTask.title) {
        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: id,
          userId: ctx.user.id,
          action: "title_changed",
          oldValue: oldTask.title,
          newValue: data.title,
          metadata: null,
          createdAt: now,
        });

        await notifyTaskMembers({
          taskId: id,
          actor: ctx.user,
          type: "task_updated",
          title: "Task renamed",
          message: `${label} renamed "${oldTask.title}" to "${data.title}"`,
        });
      }

      if (data.status && data.status !== oldTask.status) {
        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: id,
          userId: ctx.user.id,
          action: "status_changed",
          oldValue: oldTask.status,
          newValue: data.status,
          metadata: null,
          createdAt: now,
        });
        if (!markingComplete) {
          await notifyTaskMembers({
            taskId: id,
            actor: ctx.user,
            type: "task_updated",
            title: "Task status changed",
            message: `${label} changed "${taskTitle}" to ${data.status.replace(/_/g, " ")}`,
          });
        }
      }

      if (data.stage && data.stage !== oldTask.stage) {
        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: id,
          userId: ctx.user.id,
          action: "stage_changed",
          oldValue: oldTask.stage,
          newValue: data.stage,
          metadata: null,
          createdAt: now,
        });
        if (!markingComplete) {
          await notifyTaskMembers({
            taskId: id,
            actor: ctx.user,
            type: "task_updated",
            title: "Task stage changed",
            message: `${label} moved "${taskTitle}" to ${data.stage}`,
          });
        }
      }

      if (markingComplete) {
        await notifyTaskMembers({
          taskId: id,
          actor: ctx.user,
          type: "task_updated",
          title: "Task marked finished",
          message: `${label} marked "${taskTitle}" as finished`,
          extraRecipientIds: oldTask.assigneeId != null ? [oldTask.assigneeId] : [],
          includeParticipants: true,
        });
      }

      if (data.priority !== undefined && data.priority !== oldTask.priority) {
        const formatPriority = (value: string) =>
          value.charAt(0).toUpperCase() + value.slice(1);
        const priorityTitle =
          data.priority === "urgent" ? "Task marked urgent" : "Task priority changed";
        const priorityMessage =
          data.priority === "urgent"
            ? `${label} marked "${taskTitle}" as urgent`
            : `${label} changed priority on "${taskTitle}" from ${formatPriority(oldTask.priority)} to ${formatPriority(data.priority)}`;

        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: id,
          userId: ctx.user.id,
          action: "priority_changed",
          oldValue: oldTask.priority,
          newValue: data.priority,
          metadata: null,
          createdAt: now,
        });
        await notifyTaskMembers({
          taskId: id,
          actor: ctx.user,
          type: "task_updated",
          title: priorityTitle,
          message: priorityMessage,
        });
        await notifyLeads({
          actor: ctx.user,
          type: "task_updated",
          title: priorityTitle,
          message: priorityMessage,
          taskId: id,
          excludeUserIds: oldTask.assigneeId ? [oldTask.assigneeId] : [],
        });
      }

      if (
        (data.assigneeId !== undefined && data.assigneeId !== oldTask.assigneeId) ||
        clearingAssigneeOnComplete
      ) {
        const nextAssigneeId = clearingAssigneeOnComplete
          ? null
          : data.assigneeId !== undefined
            ? data.assigneeId
            : oldTask.assigneeId;
        const [oldAssignee, newAssignee] = await Promise.all([
          oldTask.assigneeId != null
            ? findById<UserDoc>(Collections.users, oldTask.assigneeId)
            : Promise.resolve(null),
          nextAssigneeId != null
            ? findById<UserDoc>(Collections.users, nextAssigneeId)
            : Promise.resolve(null),
        ]);
        const oldAssigneeLabel =
          oldAssignee?.name?.trim() || oldAssignee?.email || (oldTask.assigneeId != null ? `User #${oldTask.assigneeId}` : null);
        const newAssigneeLabel =
          newAssignee?.name?.trim() || newAssignee?.email || (nextAssigneeId != null ? `User #${nextAssigneeId}` : null);

        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: id,
          userId: ctx.user.id,
          action: "assigned",
          oldValue: oldAssigneeLabel,
          newValue: newAssigneeLabel,
          metadata: {
            oldAssigneeId: oldTask.assigneeId ?? null,
            newAssigneeId: nextAssigneeId ?? null,
            ...(clearingAssigneeOnComplete ? { reason: "task_completed" } : {}),
          },
          createdAt: now,
        });

        if (nextAssigneeId) {
          await notifyTaskMembers({
            taskId: id,
            actor: ctx.user,
            type: "task_assigned",
            title: "Assigned to you",
            message: `${label} assigned "${taskTitle}" to you`,
            extraRecipientIds: [nextAssigneeId],
            includeAssignee: false,
            includeOwner: false,
          });
          await notifyTaskMembers({
            taskId: id,
            actor: ctx.user,
            type: "task_updated",
            title: "Task reassigned",
            message: `${label} assigned "${taskTitle}" to ${newAssigneeLabel ?? "someone"}`,
            includeAssignee: false,
            excludeUserIds: [nextAssigneeId],
          });
        } else if (!clearingAssigneeOnComplete) {
          await notifyTaskMembers({
            taskId: id,
            actor: ctx.user,
            type: "task_updated",
            title: "Task updated",
            message: `${label} removed the assignee from "${taskTitle}"`,
          });
        }

        if (oldTask.assigneeId != null && oldTask.assigneeId !== nextAssigneeId) {
          if (!clearingAssigneeOnComplete) {
            await notifyTaskMembers({
              taskId: id,
              actor: ctx.user,
              type: "task_updated",
              title: "Task reassigned",
              message: `${label} reassigned "${taskTitle}" to another team member`,
              extraRecipientIds: [oldTask.assigneeId],
              includeAssignee: false,
              includeOwner: false,
            });
          }
        }

        if (!clearingAssigneeOnComplete) {
          await notifyLeads({
            actor: ctx.user,
            type: "task_updated",
            title: "Task assignee changed",
            message: `${label} updated assignee on "${taskTitle}"`,
            taskId: id,
            excludeUserIds: [
              ...(nextAssigneeId ? [nextAssigneeId] : []),
              ...(oldTask.assigneeId ? [oldTask.assigneeId] : []),
            ],
          });
        }
      }

      if (
        patch.createdBy !== undefined &&
        Number(patch.createdBy) !== Number(oldTask.createdBy)
      ) {
        const [oldOwner, newOwner] = await Promise.all([
          oldTask.createdBy != null
            ? findById<UserDoc>(Collections.users, oldTask.createdBy)
            : Promise.resolve(null),
          patch.createdBy != null
            ? findById<UserDoc>(Collections.users, patch.createdBy)
            : Promise.resolve(null),
        ]);
        const oldOwnerLabel =
          oldOwner?.name?.trim() ||
          oldOwner?.email ||
          (oldTask.createdBy != null ? `User #${oldTask.createdBy}` : null);
        const newOwnerLabel =
          newOwner?.name?.trim() ||
          newOwner?.email ||
          (patch.createdBy != null ? `User #${patch.createdBy}` : null);

        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: id,
          userId: ctx.user.id,
          action: "owner_changed",
          oldValue: oldOwnerLabel,
          newValue: newOwnerLabel,
          metadata: {
            oldOwnerId: oldTask.createdBy ?? null,
            newOwnerId: patch.createdBy ?? null,
          },
          createdAt: now,
        });

        await notifyTaskMembers({
          taskId: id,
          actor: ctx.user,
          type: "task_updated",
          title: "Task owner changed",
          message: `${label} changed the owner of "${taskTitle}" to ${newOwnerLabel ?? "someone"}`,
          extraRecipientIds: [
            ...(patch.createdBy ? [patch.createdBy] : []),
            ...(oldTask.createdBy ? [oldTask.createdBy] : []),
          ],
        });
      }

      if (data.dueDate !== undefined) {
        const prevDue =
          oldTask.dueDate instanceof Date
            ? oldTask.dueDate.toISOString()
            : oldTask.dueDate
              ? new Date(oldTask.dueDate).toISOString()
              : null;
        const nextDue = data.dueDate ? new Date(data.dueDate).toISOString() : null;
        if (prevDue !== nextDue) {
          const dueMessage = nextDue
            ? `${label} updated the deadline on "${taskTitle}" to ${formatDueLabel(nextDue)}`
            : `${label} cleared the deadline on "${taskTitle}"`;
          await notifyTaskStakeholders({
            taskId: id,
            actor: ctx.user,
            type: "task_updated",
            title: "Task deadline updated",
            message: dueMessage,
          });
        }
      }

      const otherFieldsChanged =
        (data.description !== undefined && data.description !== oldTask.description)
        || (data.projectId !== undefined && data.projectId !== oldTask.projectId);

      if (
        otherFieldsChanged
        && !data.status
        && !data.stage
        && data.assigneeId === undefined
        && data.title === undefined
        && data.dueDate === undefined
      ) {
        await notifyTaskMembers({
          taskId: id,
          actor: ctx.user,
          type: "task_updated",
          title: "Task updated",
          message: `${label} updated "${taskTitle}"`,
        });
      }

      return updated;
    }),

  reorder: authedQuery
    .input(z.object({
      items: z.array(z.object({
        id: z.number().int().positive(),
        position: z.number().int().min(0).max(100000),
        stage: projectStageSchema.optional(),
      })).min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const seen = new Set<number>();
      for (const item of input.items) {
        if (seen.has(item.id)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate task in reorder" });
        }
        seen.add(item.id);
      }

      if (useTaskMock()) return mock.mockReorderTasks(input.items, ctx.user);

      await ensureSchema();
      const now = new Date();
      const loaded: { item: (typeof input.items)[number]; oldTask: TaskDoc }[] = [];
      for (const item of input.items) {
        const oldTask = await findById<TaskDoc>(Collections.tasks, item.id);
        if (!oldTask || !belongsToUserOrg(ctx.user, oldTask.organizationId)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        }
        loaded.push({ item, oldTask });
      }

      for (const { item, oldTask } of loaded) {
        const patch: Partial<TaskDoc> = { position: item.position };
        const stageChanged = Boolean(item.stage && item.stage !== oldTask.stage);
        if (stageChanged && item.stage) {
          patch.stage = item.stage;
          patch.updatedAt = now;
          if (item.stage === "finished") {
            patch.status = "done";
            patch.assigneeId = null;
          } else if (oldTask.status === "done") {
            patch.status = "in_progress";
          }
        }

        await updateById<TaskDoc>(Collections.tasks, item.id, patch);

        if (stageChanged && item.stage) {
          const label = actorLabel(ctx.user);
          const taskTitle = oldTask.title;
          await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
            taskId: item.id,
            userId: ctx.user.id,
            action: "stage_changed",
            oldValue: oldTask.stage,
            newValue: item.stage,
            metadata: null,
            createdAt: now,
          });
          if (!isMarkingTaskComplete({ stage: item.stage }) || isCompletedTask(oldTask)) {
            await notifyTaskMembers({
              taskId: item.id,
              actor: ctx.user,
              type: "task_updated",
              title: "Task stage changed",
              message: `${label} moved "${taskTitle}" to ${item.stage}`,
            });
          } else {
            await notifyTaskMembers({
              taskId: item.id,
              actor: ctx.user,
              type: "task_updated",
              title: "Task marked finished",
              message: `${label} marked "${taskTitle}" as finished`,
              extraRecipientIds: oldTask.assigneeId != null ? [oldTask.assigneeId] : [],
              includeParticipants: true,
            });
          }
        }
      }

      return { ok: true as const };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (useTaskMock()) return mock.mockDeleteTask(input.id, ctx.user);

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.id);
      if (!task) throw new Error("Task not found");

      if (task.createdBy !== ctx.user.id && ctx.user.role === "employee") {
        throw new Error("Not authorized to delete this task");
      }

      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      await taskCol.deleteOne({ id: input.id });
      return { success: true };
    }),

  updateStatus: authedQuery
    .input(z.object({ id: z.number(), status: z.enum(["todo", "in_progress", "review", "done"]) }))
    .mutation(async ({ input, ctx }) => {
      if (useTaskMock()) {
        const updated = mock.mockUpdateStatus(input.id, input.status, ctx.user);
        if (!updated) throw new Error("Task not found");
        return updated;
      }

      await ensureSchema();
      const oldTask = await findById<TaskDoc>(Collections.tasks, input.id);
      if (!oldTask) throw new Error("Task not found");

      const patch: Partial<TaskDoc> = {
        status: input.status,
        stage: legacyStatusToStage(input.status),
        updatedAt: new Date(),
      };
      if (input.status === "done") {
        patch.assigneeId = null;
      }

      const updated = await updateById<TaskDoc>(Collections.tasks, input.id, patch);
      if (!updated) throw new Error("Task not found");

      if (input.status !== oldTask.status) {
        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: input.id,
          userId: ctx.user.id,
          action: "status_changed",
          oldValue: oldTask.status,
          newValue: input.status,
          metadata: null,
          createdAt: new Date(),
        });
        await notifyTaskMembers({
          taskId: input.id,
          actor: ctx.user,
          type: "task_updated",
          title: input.status === "done" ? "Task marked finished" : "Task status changed",
          message:
            input.status === "done"
              ? `${actorLabel(ctx.user)} marked "${oldTask.title}" as finished`
              : `${actorLabel(ctx.user)} changed "${oldTask.title}" to ${input.status.replace(/_/g, " ")}`,
          extraRecipientIds:
            input.status === "done" && oldTask.assigneeId != null ? [oldTask.assigneeId] : [],
          includeParticipants: input.status === "done",
        });
      }

      if (input.status === "done" && oldTask.assigneeId != null) {
        const oldAssignee = await findById<UserDoc>(Collections.users, oldTask.assigneeId);
        const oldAssigneeLabel =
          oldAssignee?.name?.trim() ||
          oldAssignee?.email ||
          `User #${oldTask.assigneeId}`;
        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: input.id,
          userId: ctx.user.id,
          action: "assigned",
          oldValue: oldAssigneeLabel,
          newValue: null,
          metadata: {
            oldAssigneeId: oldTask.assigneeId,
            newAssigneeId: null,
            reason: "task_completed",
          },
          createdAt: new Date(),
        });
      }

      return updated;
    }),

  addParticipant: authedQuery
    .input(z.object({ taskId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertTaskMemberAllowed(input.userId);
      await assertInvitedClientAssigneeAllowed(ctx.user, input.userId);
      if (useTaskMock()) return mock.mockAddParticipant(input.taskId, input.userId, ctx.user);

      await ensureSchema();
      const participantUser = await findById<UserDoc>(Collections.users, input.userId);
      const participantLabel =
        participantUser?.name?.trim() || participantUser?.email || `User #${input.userId}`;

      const participantCol = await getCollection<TaskParticipantDoc>(Collections.taskParticipants);
      const existing = await participantCol.findOne({
        taskId: input.taskId,
        userId: input.userId,
        role: "participant",
      });
      if (!existing) {
        await insertDoc<TaskParticipantDoc>(Collections.taskParticipants, {
          taskId: input.taskId,
          userId: input.userId,
          role: "participant",
          createdAt: new Date(),
        });
      }

      await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: input.taskId,
        userId: ctx.user.id,
        action: "participant_added",
        oldValue: null,
        newValue: participantLabel,
        metadata: { participantId: input.userId },
        createdAt: new Date(),
      });

      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      await notifyTaskMembers({
        taskId: input.taskId,
        actor: ctx.user,
        type: "task_updated",
        title: "Added as participant",
        message: `${actorLabel(ctx.user)} added you as a participant on "${task?.title ?? "a task"}"`,
        extraRecipientIds: [input.userId],
        includeAssignee: false,
        includeOwner: false,
      });

      return { success: true };
    }),

  removeParticipant: authedQuery
    .input(z.object({ taskId: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      if (useTaskMock()) return mock.mockRemoveParticipant(input.taskId, input.userId);

      await ensureSchema();
      const participantCol = await getCollection<TaskParticipantDoc>(Collections.taskParticipants);
      await participantCol.deleteOne({
        taskId: input.taskId,
        userId: input.userId,
        role: "participant",
      });
      return { success: true };
    }),

  addObserver: authedQuery
    .input(z.object({ taskId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertTaskMemberAllowed(input.userId);
      await assertInvitedClientAssigneeAllowed(ctx.user, input.userId);
      if (useTaskMock()) return mock.mockAddObserver(input.taskId, input.userId, ctx.user);

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      if (!task) return { success: false };
      if (task.assigneeId === input.userId) return { success: false };

      const participantCol = await getCollection<TaskParticipantDoc>(Collections.taskParticipants);
      const existing = await participantCol.findOne({
        taskId: input.taskId,
        userId: input.userId,
        role: "observer",
      });
      if (!existing) {
        const observerUser = await findById<UserDoc>(Collections.users, input.userId);
        const observerLabel =
          observerUser?.name?.trim() || observerUser?.email || `User #${input.userId}`;

        await insertDoc<TaskParticipantDoc>(Collections.taskParticipants, {
          taskId: input.taskId,
          userId: input.userId,
          role: "observer",
          createdAt: new Date(),
        });

        await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
          taskId: input.taskId,
          userId: ctx.user.id,
          action: "observer_added",
          oldValue: null,
          newValue: observerLabel,
          metadata: { observerId: input.userId },
          createdAt: new Date(),
        });

        await notifyTaskMembers({
          taskId: input.taskId,
          actor: ctx.user,
          type: "task_updated",
          title: "Added as observer",
          message: `${actorLabel(ctx.user)} added you as an observer on "${task.title}"`,
          extraRecipientIds: [input.userId],
          includeAssignee: false,
          includeOwner: false,
        });
      }

      return { success: true };
    }),

  removeObserver: authedQuery
    .input(z.object({ taskId: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      if (useTaskMock()) return mock.mockRemoveObserver(input.taskId, input.userId);

      await ensureSchema();
      const participantCol = await getCollection<TaskParticipantDoc>(Collections.taskParticipants);
      await participantCol.deleteOne({
        taskId: input.taskId,
        userId: input.userId,
        role: "observer",
      });
      return { success: true };
    }),

  getActiveTimer: authedQuery
    .input(z.object({ taskId: z.number() }))
    .query(async ({ ctx, input }) => {
      if (useTaskMock()) return mock.mockGetActiveTaskTimer(ctx.user.id, input.taskId);

      await ensureSchema();
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entry = await timeCol
        .find({
          userId: ctx.user.id,
          taskId: input.taskId,
          clockOut: null,
        })
        .sort({ clockIn: -1 })
        .limit(1)
        .next();

      return entry
        ? { taskId: input.taskId, startedAt: entry.clockIn, paused: false, accumulatedSeconds: 0 }
        : null;
    }),

  getMyActiveTimer: authedQuery.query(async ({ ctx }) => {
    if (useTaskMock()) return mock.mockGetMyActiveTaskTimer(ctx.user.id);

    await ensureSchema();
    const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
    // Only running *task* timers — ignore attendance clock-ins (taskId: null).
    const entry = await timeCol
      .find({
        userId: ctx.user.id,
        taskId: { $ne: null, $type: "number" },
        clockOut: null,
      })
      .sort({ clockIn: -1 })
      .limit(1)
      .next();

    if (!entry || entry.taskId == null) return null;

    const task = await findById<TaskDoc>(Collections.tasks, entry.taskId);
    // Orphaned open entries (deleted task) should not block starting a new timer.
    if (!task) return null;

    return {
      taskId: entry.taskId,
      taskTitle: task.title,
      startedAt: entry.clockIn,
      paused: false,
      accumulatedSeconds: 0,
    };
  }),

  startTimer: authedQuery
    .input(
      z.object({
        taskId: z.number(),
        /** Client click time — used so slow server work does not steal tracked seconds. */
        clientStartedAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) {
        return mock.mockStartTaskTimer(ctx.user.id, input.taskId, ctx.user, input.clientStartedAt);
      }

      // Capture start time before any awaits so tracked time matches the user's click.
      const requestReceivedAt = new Date();
      const client = input.clientStartedAt;
      let now = requestReceivedAt;
      if (client instanceof Date && Number.isFinite(client.getTime())) {
        const clientMs = client.getTime();
        const serverMs = requestReceivedAt.getTime();
        const notFarFuture = clientMs <= serverMs + 5_000;
        const withinSkew = Math.abs(serverMs - clientMs) <= 120_000;
        if (notFarFuture && withinSkew) {
          now = client;
        }
      }

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      if (!task) throw new Error("Task not found");
      if (!(await canManageTaskTime(ctx.user, task))) {
        throw new Error("Only the assignee or participants can start the timer on this task");
      }

      await pauseOtherRunningTaskTimers(ctx.user, input.taskId, now);

      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      // Close any leftover open session so each Start begins a fresh 00:00:00 run.
      const openEntries = await timeCol
        .find({
          userId: ctx.user.id,
          taskId: input.taskId,
          clockOut: null,
        })
        .toArray();
      for (const open of openEntries) {
        const durationSeconds = Math.max(
          0,
          Math.floor((now.getTime() - open.clockIn.getTime()) / 1000),
        );
        await updateById<TimeEntryDoc>(Collections.timeEntries, open.id, {
          clockOut: now,
          duration: Math.floor(durationSeconds / 60),
          durationSeconds,
          note: open.note?.includes("paused") ? open.note : "Task timer (auto-closed)",
          updatedAt: now,
        });
      }

      await insertDoc<TimeEntryDoc>(Collections.timeEntries, {
        userId: ctx.user.id,
        organizationId: requireOrganizationId(ctx.user),
        taskId: input.taskId,
        projectId: task.projectId ?? null,
        clockIn: now,
        clockOut: null,
        duration: null,
        durationSeconds: null,
        note: "Task timer",
        source: "web",
        createdAt: now,
        updatedAt: now,
      });

      // Activity + notifications are non-blocking so Start returns immediately.
      void insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: input.taskId,
        userId: ctx.user.id,
        action: "time_logged",
        oldValue: null,
        newValue: "started timer",
        metadata: null,
        createdAt: now,
      }).catch(() => undefined);

      void notifyTaskMembers({
        taskId: input.taskId,
        actor: ctx.user,
        type: "task_updated",
        title: "Timer started",
        message: `${actorLabel(ctx.user)} started the timer on "${task.title}"`,
      }).catch(() => undefined);

      return { taskId: input.taskId, startedAt: now };
    }),

  pauseTimer: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) return mock.mockPauseTaskTimer(ctx.user.id, input.taskId, ctx.user);

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      if (!task) throw new Error("Task not found");
      if (!(await canManageTaskTime(ctx.user, task))) {
        throw new Error("Only the assignee or participants can pause the timer on this task");
      }

      const now = new Date();
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entry = await timeCol
        .find({
          userId: ctx.user.id,
          taskId: input.taskId,
          clockOut: null,
        })
        .sort({ clockIn: -1 })
        .limit(1)
        .next();

      if (!entry) throw new Error("No running timer for this task");

      const durationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - entry.clockIn.getTime()) / 1000),
      );
      const duration = Math.floor(durationSeconds / 60);
      await updateById<TimeEntryDoc>(Collections.timeEntries, entry.id, {
        clockOut: now,
        duration,
        durationSeconds,
        note: "Task timer (paused)",
        updatedAt: now,
      });

      await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: input.taskId,
        userId: ctx.user.id,
        action: "time_logged",
        oldValue: null,
        newValue: duration > 0 ? `paused timer ${duration} minutes` : "paused timer",
        metadata: null,
        createdAt: now,
      });

      await notifyTaskMembers({
        taskId: input.taskId,
        actor: ctx.user,
        type: "task_updated",
        title: "Timer paused",
        message: `${actorLabel(ctx.user)} paused the timer on "${task.title}"`,
      });

      return { accumulatedSeconds: durationSeconds };
    }),

  stopTimer: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) return mock.mockStopTaskTimer(ctx.user.id, input.taskId, ctx.user);

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      if (!task) throw new Error("Task not found");
      if (!(await canManageTaskTime(ctx.user, task))) {
        throw new Error("Only the assignee or participants can stop the timer on this task");
      }

      const now = new Date();
      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entry = await timeCol
        .find({
          userId: ctx.user.id,
          taskId: input.taskId,
          clockOut: null,
        })
        .sort({ clockIn: -1 })
        .limit(1)
        .next();

      if (!entry) throw new Error("No active timer for this task");

      const durationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - entry.clockIn.getTime()) / 1000),
      );
      const duration = Math.floor(durationSeconds / 60);
      await updateById<TimeEntryDoc>(Collections.timeEntries, entry.id, {
        clockOut: now,
        duration,
        durationSeconds,
        updatedAt: now,
      });

      await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: input.taskId,
        userId: ctx.user.id,
        action: "time_logged",
        oldValue: null,
        newValue: `${duration} minutes`,
        metadata: null,
        createdAt: now,
      });

      await notifyTaskMembers({
        taskId: input.taskId,
        actor: ctx.user,
        type: "task_updated",
        title: "Timer stopped",
        message: `${actorLabel(ctx.user)} stopped the timer on "${task.title}" (${duration} min)`,
      });

      return { durationMinutes: duration };
    }),

  updateTimeEntry: authedQuery
    .input(z.object({
      taskId: z.number(),
      entryId: z.number(),
      clockIn: z.string(),
      clockOut: z.string(),
      reason: z.string().min(1, "A reason is required to edit time entries"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) {
        return mock.mockUpdateTaskTimeEntry(ctx.user, input);
      }

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      if (!task) throw new Error("Task not found");

      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entry = await timeCol.findOne({ id: input.entryId, taskId: input.taskId });
      if (!entry) throw new Error("Time entry not found");
      if (!entry.clockOut) throw new Error("Cannot edit an active timer session");
      if (!(await canEditTaskTimeEntry(ctx.user, task, entry))) {
        throw new Error("Not allowed to edit this time entry");
      }

      const clockIn = new Date(input.clockIn);
      const clockOut = new Date(input.clockOut);
      if (clockOut <= clockIn) throw new Error("End time must be after start time");

      const previousDurationSeconds =
        typeof entry.durationSeconds === "number" && entry.durationSeconds >= 0
          ? entry.durationSeconds
          : (entry.duration ?? 0) * 60;
      const durationSeconds = Math.max(
        0,
        Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000),
      );
      const duration = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000);
      const now = new Date();
      const noteSuffix = `(edited: ${input.reason.trim()})`;
      const note = entry.note ? `${entry.note} ${noteSuffix}` : noteSuffix;
      const currentActualHours = parseFloat(task.actualHours ?? "0") || 0;
      const adjustedActualHours =
        currentActualHours + (durationSeconds - previousDurationSeconds) / 3600;

      const updated = await updateById<TimeEntryDoc>(Collections.timeEntries, input.entryId, {
        clockIn,
        clockOut,
        duration,
        durationSeconds,
        note,
        source: entry.source === "manual" ? "manual" : entry.source,
        updatedAt: now,
      });
      await updateById<TaskDoc>(Collections.tasks, input.taskId, {
        actualHours: Math.max(0, adjustedActualHours).toFixed(2),
        updatedAt: now,
      });

      await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: input.taskId,
        userId: ctx.user.id,
        action: "time_logged",
        oldValue: null,
        newValue: `Time entry edited — ${duration} min`,
        metadata: { entryId: input.entryId, reason: input.reason.trim() },
        createdAt: now,
      });

      await notifyTaskMembers({
        taskId: input.taskId,
        actor: ctx.user,
        type: "task_updated",
        title: "Time entry updated",
        message: `${actorLabel(ctx.user)} edited time logged on "${task.title}"`,
      });

      return updated;
    }),

  deleteTimeEntry: authedQuery
    .input(z.object({
      taskId: z.number(),
      entryId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) {
        return mock.mockDeleteTaskTimeEntry(ctx.user, input);
      }

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      if (!task) throw new Error("Task not found");

      const timeCol = await getCollection<TimeEntryDoc>(Collections.timeEntries);
      const entry = await timeCol.findOne({ id: input.entryId, taskId: input.taskId });
      if (!entry) throw new Error("Time entry not found");
      if (!entry.clockOut) throw new Error("Cannot delete an active timer session");
      if (!(await canEditTaskTimeEntry(ctx.user, task, entry))) {
        throw new Error("Not allowed to delete this time entry");
      }

      const durationSeconds =
        typeof entry.durationSeconds === "number" && entry.durationSeconds >= 0
          ? entry.durationSeconds
          : (entry.duration ?? 0) * 60;
      const durationMinutes = Math.floor(durationSeconds / 60);
      const now = new Date();
      const currentActualHours = parseFloat(task.actualHours ?? "0") || 0;
      const adjustedActualHours = currentActualHours - durationSeconds / 3600;

      await timeCol.deleteOne({ id: input.entryId, taskId: input.taskId });
      await updateById<TaskDoc>(Collections.tasks, input.taskId, {
        actualHours: Math.max(0, adjustedActualHours).toFixed(2),
        updatedAt: now,
      });

      await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: input.taskId,
        userId: ctx.user.id,
        action: "time_logged",
        oldValue: null,
        newValue: `Time entry deleted — ${durationMinutes} min`,
        metadata: { entryId: input.entryId },
        createdAt: now,
      });

      await notifyTaskMembers({
        taskId: input.taskId,
        actor: ctx.user,
        type: "task_updated",
        title: "Time entry deleted",
        message: `${actorLabel(ctx.user)} deleted time logged on "${task.title}"`,
      });

      return { success: true as const };
    }),

  addManualTimeEntry: authedQuery
    .input(z.object({
      taskId: z.number(),
      userId: z.number().optional(),
      clockIn: z.string(),
      clockOut: z.string(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) {
        return mock.mockAddManualTaskTimeEntry(ctx.user, input);
      }

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      if (!task) throw new Error("Task not found");

      const targetUserId = input.userId ?? ctx.user.id;
      const canManageTime = await canManageTaskTime(ctx.user, task);
      if (!sameUserId(targetUserId, ctx.user.id) && !canManageTime) {
        throw new Error("Not allowed to add time for this user");
      }

      const clockIn = new Date(input.clockIn);
      const clockOut = new Date(input.clockOut);
      if (clockOut <= clockIn) throw new Error("End time must be after start time");

      const durationSeconds = Math.max(
        0,
        Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000),
      );
      const duration = Math.floor(durationSeconds / 60);
      const now = new Date();

      const entry = await insertDoc<TimeEntryDoc>(Collections.timeEntries, {
        userId: targetUserId,
        organizationId: requireOrganizationId(ctx.user),
        taskId: input.taskId,
        projectId: task.projectId ?? null,
        clockIn,
        clockOut,
        duration,
        durationSeconds,
        note: input.note?.trim() || "Manual entry",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      });

      await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: input.taskId,
        userId: ctx.user.id,
        action: "time_logged",
        oldValue: null,
        newValue: `Manual time added — ${duration} min`,
        metadata: { entryId: entry.id, targetUserId },
        createdAt: now,
      });

      await notifyTaskMembers({
        taskId: input.taskId,
        actor: ctx.user,
        type: "task_updated",
        title: "Time logged",
        message: `${actorLabel(ctx.user)} added ${duration} min of time on "${task.title}"`,
      });

      return entry;
    }),

  addComment: authedQuery
    .input(z.object({ taskId: z.number(), message: z.string().min(1).max(50000) }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) return mock.mockAddTaskComment(input.taskId, input.message, ctx.user);

      await ensureSchema();
      const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
      const previewSource = richCommentPlainText(input.message) || formatCommentPreview(input.message);
      const preview = previewSource.length > 120 ? `${previewSource.slice(0, 120)}…` : previewSource;
      const mentionedUserIds = extractMentionedUserIdsFromComment(input.message);

      const activity = await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
        taskId: input.taskId,
        userId: ctx.user.id,
        action: "commented",
        oldValue: null,
        newValue: input.message,
        metadata: null,
        createdAt: new Date(),
      });

      if (mentionedUserIds.length > 0) {
        await notifyTaskMembers({
          taskId: input.taskId,
          actor: ctx.user,
          type: "mention",
          title: "You were mentioned in a comment",
          message: `${actorLabel(ctx.user)} mentioned you on "${task?.title ?? "a task"}": ${preview}`,
          activityId: activity.id,
          extraRecipientIds: mentionedUserIds,
          includeAssignee: false,
          includeOwner: false,
        });
      }
      await notifyTaskMembers({
        taskId: input.taskId,
        actor: ctx.user,
        type: "mention",
        title: "New comment on task",
        message: `${actorLabel(ctx.user)}: ${preview}`,
        activityId: activity.id,
        excludeUserIds: mentionedUserIds,
      });

      return { success: true };
    }),

  editComment: authedQuery
    .input(z.object({
      taskId: z.number(),
      activityId: z.number(),
      message: z.string().min(1).max(50000),
    }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) {
        return mock.mockEditTaskComment(
          input.taskId,
          input.activityId,
          input.message,
          ctx.user,
        );
      }

      await ensureSchema();
      const activityCol = await getCollection<TaskActivityDoc>(Collections.taskActivity);
      const activity = await findById<TaskActivityDoc>(Collections.taskActivity, input.activityId);
      if (!activity || activity.taskId !== input.taskId) throw new Error("Comment not found");
      if (activity.action !== "commented") throw new Error("Only comments can be edited");
      if (activity.userId !== ctx.user.id) throw new Error("You can only edit your own comments");
      if (activity.metadata && typeof activity.metadata === "object" && "subtaskId" in activity.metadata) {
        throw new Error("This message cannot be edited");
      }

      const editedAt = new Date();
      const previousMessage = activity.newValue ?? "";
      await activityCol.updateOne(
        { id: input.activityId },
        {
          $set: {
            oldValue: previousMessage,
            newValue: input.message,
            metadata: {
              ...(activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {}),
              editedAt: editedAt.toISOString(),
            },
          },
        },
      );

      const previousMentionIds = new Set(extractMentionedUserIdsFromComment(previousMessage));
      const newlyMentioned = extractMentionedUserIdsFromComment(input.message).filter(
        (id) => !previousMentionIds.has(id),
      );
      if (newlyMentioned.length > 0) {
        const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
        const previewSource = richCommentPlainText(input.message) || formatCommentPreview(input.message);
        const preview = previewSource.length > 120 ? `${previewSource.slice(0, 120)}…` : previewSource;
        await notifyTaskMembers({
          taskId: input.taskId,
          actor: ctx.user,
          type: "mention",
          title: "You were mentioned in a comment",
          message: `${actorLabel(ctx.user)} mentioned you on "${task?.title ?? "a task"}": ${preview}`,
          activityId: input.activityId,
          extraRecipientIds: newlyMentioned,
          includeAssignee: false,
          includeOwner: false,
        });
      }

      return { success: true, editedAt };
    }),

  deleteComment: authedQuery
    .input(z.object({
      taskId: z.number(),
      activityId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) {
        return mock.mockDeleteTaskComment(input.taskId, input.activityId, ctx.user);
      }

      await ensureSchema();
      const activityCol = await getCollection<TaskActivityDoc>(Collections.taskActivity);
      const activity = await findById<TaskActivityDoc>(Collections.taskActivity, input.activityId);
      if (!activity || activity.taskId !== input.taskId) throw new Error("Comment not found");
      if (activity.action !== "commented") throw new Error("Only comments can be deleted");
      if (activity.userId !== ctx.user.id) throw new Error("You can only delete your own comments");
      if (activity.metadata && typeof activity.metadata === "object" && "subtaskId" in activity.metadata) {
        throw new Error("This message cannot be deleted");
      }

      await activityCol.deleteOne({ id: input.activityId });
      return { success: true };
    }),

  toggleCommentReaction: authedQuery
    .input(z.object({
      taskId: z.number(),
      activityId: z.number(),
      emoji: z.string().trim().min(1).max(32),
    }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) {
        return mock.mockToggleCommentReaction(
          input.taskId,
          input.activityId,
          input.emoji,
          ctx.user,
        );
      }

      await ensureSchema();
      const activity = await findById<TaskActivityDoc>(Collections.taskActivity, input.activityId);
      if (!activity || activity.taskId !== input.taskId) throw new Error("Comment not found");
      if (activity.action !== "commented") throw new Error("Only comments can be reacted to");
      if (activity.metadata && typeof activity.metadata === "object" && "subtaskId" in activity.metadata) {
        throw new Error("This message cannot be reacted to");
      }

      const emoji = input.emoji.trim();
      const baseMeta =
        activity.metadata && typeof activity.metadata === "object"
          ? { ...(activity.metadata as Record<string, unknown>) }
          : {};
      const previousReactions = readCommentReactions(baseMeta);
      const reactions = toggleUserReaction(previousReactions, emoji, ctx.user.id);
      const added =
        Boolean(reactions[emoji]?.includes(ctx.user.id)) &&
        !Boolean(previousReactions[emoji]?.includes(ctx.user.id));

      const nextMetadata = {
        ...baseMeta,
        reactions,
      };

      const updated = await updateById<TaskActivityDoc>(
        Collections.taskActivity,
        input.activityId,
        { metadata: nextMetadata },
      );
      if (!updated) throw new Error("Comment not found");

      if (added) {
        const task = await findById<TaskDoc>(Collections.tasks, input.taskId);
        await notifyTaskMembers({
          taskId: input.taskId,
          actor: ctx.user,
          type: "task_updated",
          title: "New reaction on comment",
          message: `${actorLabel(ctx.user)} reacted ${emoji} on a comment in "${task?.title ?? "a task"}"`,
          activityId: activity.id,
          includeAssignee: true,
        });
      }

      return { success: true, reactions };
    }),

  listWorkspaceFiles: authedQuery.query(async ({ ctx }) => {
    assertAnyPermission(ctx.user, ["tasks.view_all", "tasks.view_own", "tasks.create"]);
    if (useTaskMock()) return mock.mockListWorkspaceFiles();

    await ensureSchema();
    const taskCol = await getCollection<TaskDoc>(Collections.tasks);
    const tasks = await taskCol
      .find({ ...orgFilter(ctx.user) })
      .project({ id: 1, title: 1, projectId: 1 })
      .toArray();
    const taskIds = tasks.map((task) => task.id);
    if (taskIds.length === 0) return [];

    const attachmentCol = await getCollection<TaskAttachmentDoc>(Collections.taskAttachments);
    const attachments = await attachmentCol
      .find({ taskId: { $in: taskIds }, ...LISTED_IN_FILES_FILTER })
      .project({ dataBase64: 0, gridFsId: 0 })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const projectIds = [
      ...new Set(
        tasks
          .map((task) => task.projectId)
          .filter((id): id is number => id != null),
      ),
    ];
    const projectCol = await getCollection<ProjectDoc>(Collections.projects);
    const projects =
      projectIds.length > 0
        ? await projectCol.find({ id: { $in: projectIds } }).project({ id: 1, name: 1 }).toArray()
        : [];
    const projectMap = new Map(projects.map((project) => [project.id, project]));

    return attachments.map((attachment) => {
      const task = taskMap.get(attachment.taskId);
      const project = task?.projectId != null ? projectMap.get(task.projectId) : null;
      return {
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        createdAt: attachment.createdAt,
        taskId: attachment.taskId,
        taskTitle: task?.title ?? "Task",
        projectName: project?.name ?? null,
      };
    });
  }),

  listWorkspaceMeetings: authedQuery.query(async ({ ctx }) => {
    assertAnyPermission(ctx.user, ["tasks.view_all", "tasks.view_own", "tasks.create"]);
    if (useTaskMock()) return mock.mockListWorkspaceMeetings();

    await ensureSchema();
    const taskCol = await getCollection<TaskDoc>(Collections.tasks);
    const tasks = await taskCol
      .find({ ...orgFilter(ctx.user) })
      .project({ id: 1, title: 1, projectId: 1 })
      .toArray();
    const taskIds = tasks.map((task) => task.id);
    if (taskIds.length === 0) return [];

    const activityCol = await getCollection<TaskActivityDoc>(Collections.taskActivity);
    const activities = await activityCol
      .find({
        taskId: { $in: taskIds },
        action: "commented",
        newValue: { $regex: "Event or meeting:", $options: "i" },
      })
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray();

    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const projectIds = [
      ...new Set(
        tasks
          .map((task) => task.projectId)
          .filter((id): id is number => id != null),
      ),
    ];
    const projectCol = await getCollection<ProjectDoc>(Collections.projects);
    const projects =
      projectIds.length > 0
        ? await projectCol.find({ id: { $in: projectIds } }).project({ id: 1, name: 1 }).toArray()
        : [];
    const projectMap = new Map(projects.map((project) => [project.id, project]));
    const userIds = [...new Set(activities.map((activity) => activity.userId).filter((id): id is number => id != null))];
    const userMap = await findUsersByIds(userIds);

    return activities
      .map((activity) => {
        const parsed = parseMeetingComment(activity.newValue);
        if (!parsed) return null;
        const task = taskMap.get(activity.taskId);
        const project = task?.projectId != null ? projectMap.get(task.projectId) : null;
        const creator = activity.userId ? userMap.get(activity.userId) ?? null : null;
        return {
          id: activity.id,
          title: parsed.title,
          when: parsed.when,
          createdAt: activity.createdAt,
          taskId: activity.taskId,
          taskTitle: task?.title ?? "Task",
          projectName: project?.name ?? null,
          createdByName: creator?.name ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }),

  listAttachments: authedQuery
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      if (useTaskMock()) return mock.mockListTaskAttachments(input.taskId);

      await ensureSchema();
      const attachmentCol = await getCollection<TaskAttachmentDoc>(Collections.taskAttachments);
      const attachments = await attachmentCol
        .find({ taskId: input.taskId, ...LISTED_IN_FILES_FILTER })
        .project({ dataBase64: 0, gridFsId: 0 })
        .sort({ createdAt: -1 })
        .toArray();
      return attachments.map(attachmentMeta);
    }),

  getAttachment: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      if (useTaskMock()) return mock.mockGetTaskAttachment(input.id);

      await ensureSchema();
      const doc = await findById<TaskAttachmentDoc>(Collections.taskAttachments, input.id);
      if (!doc) return null;

      if (doc.gridFsId) {
        const buffer = await downloadAttachmentFromGridFs(doc.gridFsId);
        return {
          ...attachmentMeta(doc),
          dataBase64: buffer.toString("base64"),
        };
      }

      return {
        ...attachmentMeta(doc),
        dataBase64: doc.dataBase64 ?? "",
      };
    }),

  addAttachment: authedQuery
    .input(z.object({
      taskId: z.number(),
      fileName: z.string().min(1).max(500),
      mimeType: z.string().max(255).default("application/octet-stream"),
      fileSize: z.number().int().nonnegative(),
      dataBase64: z.string().min(1).max(1_500_000_000),
      /** false = comment/chat/description media only (hidden from Files). */
      listedInFiles: z.boolean().optional().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      if (useTaskMock()) {
        const { dataBase64, ...meta } = input;
        return mock.mockAddTaskAttachment({ ...meta, dataBase64 }, ctx.user);
      }

      await ensureSchema();
      const now = new Date();

      // Store binary in GridFS so many / large files never hit Mongo's 16MB BSON limit.
      const stored = await uploadAttachmentToGridFs({
        fileName: input.fileName,
        mimeType: input.mimeType,
        dataBase64: input.dataBase64,
      });

      const attachment = await insertDoc<TaskAttachmentDoc>(Collections.taskAttachments, {
        taskId: input.taskId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize || stored.byteLength,
        gridFsId: stored.gridFsId,
        listedInFiles: input.listedInFiles,
        uploadedBy: ctx.user.id,
        createdAt: now,
      });
      return attachmentMeta(attachment);
    }),

  deleteAttachment: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      if (useTaskMock()) return mock.mockDeleteTaskAttachment(input.id);

      await ensureSchema();
      const attachmentCol = await getCollection<TaskAttachmentDoc>(Collections.taskAttachments);
      const existing = await findById<TaskAttachmentDoc>(Collections.taskAttachments, input.id);
      if (existing?.gridFsId) {
        await deleteAttachmentFromGridFs(existing.gridFsId);
      }
      await attachmentCol.deleteOne({ id: input.id });
      return { success: true };
    }),

  bulkAction: authedQuery
    .input(
      z.object({
        taskIds: z.array(z.number()).min(1).max(100),
        action: z.enum(["delete", "status", "move_project"]),
        status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
        projectId: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (useTaskMock()) {
        return mock.mockBulkTaskAction(input, ctx.user);
      }

      await ensureSchema();
      const taskCol = await getCollection<TaskDoc>(Collections.tasks);
      const tasks = await taskCol.find({ id: { $in: input.taskIds } }).toArray();

      if (tasks.length === 0) {
        throw new Error("No tasks found");
      }

      for (const task of tasks) {
        if (task.projectId != null) {
          const project = await findById<ProjectDoc>(Collections.projects, task.projectId);
          const joined = project
            ? await isProjectMember(task.projectId, ctx.user.id, project.createdBy)
            : false;
          if (!canViewProjectTasks(ctx.user, project?.createdBy ?? null, joined)) {
            throw new Error("Not authorized to modify tasks in this project");
          }
        }

        const canEdit =
          ctx.user.role === "admin" ||
          ctx.user.role === "manager" ||
          hasPermission(ctx.user, "tasks.edit_all") ||
          (hasPermission(ctx.user, "tasks.edit_own") &&
            (task.createdBy === ctx.user.id || task.assigneeId === ctx.user.id));

        const canDelete =
          ctx.user.role === "admin" ||
          ctx.user.role === "manager" ||
          hasPermission(ctx.user, "tasks.delete") ||
          task.createdBy === ctx.user.id;

        if (input.action === "delete" && !canDelete) {
          throw new Error("Not authorized to delete one or more tasks");
        }
        if (input.action !== "delete" && !canEdit) {
          throw new Error("Not authorized to update one or more tasks");
        }
      }

      const now = new Date();

      if (input.action === "delete") {
        const ids = tasks.map((t) => t.id);
        const taskFilter = { taskId: { $in: ids } };
        await Promise.all([
          getCollection(Collections.taskParticipants).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.subtasks).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.taskActivity).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.taskAttachments).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.taskTagRelations).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.timeEntries).then((c) => c.deleteMany(taskFilter)),
          getCollection(Collections.notifications).then((c) => c.deleteMany({ taskId: { $in: ids } })),
        ]);
        await taskCol.deleteMany({ id: { $in: ids } });
        return { success: true, affected: ids.length };
      }

      if (input.action === "status") {
        if (!input.status) throw new Error("Status is required");
        const setFields: Record<string, unknown> = {
          status: input.status,
          stage: legacyStatusToStage(input.status),
          updatedAt: now,
        };
        if (input.status === "done") {
          setFields.assigneeId = null;
        }
        await taskCol.updateMany(
          { id: { $in: input.taskIds } },
          { $set: setFields },
        );
        return { success: true, affected: input.taskIds.length };
      }

      if (input.action === "move_project") {
        if (input.projectId != null) {
          const project = await findById<ProjectDoc>(Collections.projects, input.projectId);
          if (!project) throw new Error("Target project not found");
        }
        await taskCol.updateMany(
          { id: { $in: input.taskIds } },
          { $set: { projectId: input.projectId ?? null, updatedAt: now } },
        );
        return { success: true, affected: input.taskIds.length };
      }

      throw new Error("Unsupported action");
    }),
});
