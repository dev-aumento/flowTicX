import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { ProjectHeaderCard } from "@/components/projects/ProjectHeaderCard";
import { ProjectKanbanHeader } from "@/components/projects/ProjectKanbanHeader";
import { ProjectFormFields } from "@/components/projects/ProjectFormFields";
import { TaskKanbanBoard } from "@/components/tasks/TaskKanbanBoard";
import { TaskListView } from "@/components/tasks/TaskListView";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import {
  CreateTaskModal,
  createEmptyTaskForm,
  type CreateTaskFormData,
} from "@/components/tasks/CreateTaskModal";
import {
  applyTaskSearchFilters,
  DEFAULT_TASK_SEARCH_FILTERS,
} from "@/lib/task-search-filter";
import {
  computeProjectStatsFromTasks,
  invalidateProjectStats,
} from "@/lib/project-stats";
import { invalidateTaskQueries } from "@/lib/invalidate-on-notifications";
import { hasPermission } from "@/lib/permissions";
import { isClientPortalUser } from "@/lib/client-portal";
import { canCreateTask, tryOpenCreateTask } from "@/lib/create-task-permission";
import { submitCreateTask } from "@/lib/submit-create-task";
import { resetStagingMediaIds } from "@/lib/staged-task-media";
import type { ProjectPipelineStageKey } from "@/lib/task-kanban";
import {
  extractCustomPipelineStages,
  isCompletedTask,
  resolveProjectPipelineStages,
} from "@/lib/task-kanban";
import {
  parseActivityIdParam,
} from "@/lib/task-notification-link";
import {
  collectClientNameSuggestions,
  EMPTY_PROJECT_FORM,
  projectToFormValues,
  type ProjectFormValues,
} from "@/lib/project-appearance";
import { useLocateTaskInView } from "@/hooks/useLocateTaskInView";
import { useOrgPipelineLabelOverrides } from "@/hooks/useOrgPipelineStages";
import { ModalBackdrop } from "@/components/shared/ModalBackdrop";
import { TaskBulkActionBar } from "@/components/tasks/TaskBulkActionBar";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, UserPlus, X } from "lucide-react";

type ProjectTaskView = "list" | "kanban";

function parseProjectView(raw: string | null): ProjectTaskView {
  if (raw === "list") return "list";
  return "kanban";
}

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const orgLabelOverrides = useOrgPipelineLabelOverrides();
  const clientPortal = isClientPortalUser(user);
  const taskView = parseProjectView(searchParams.get("view"));
  const projectsBackPath = "/projects";
  const selectedTask = searchParams.get("task") ? Number(searchParams.get("task")) : null;
  const highlightActivityId = useMemo(
    () => parseActivityIdParam(searchParams.get("activity")),
    [searchParams],
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<ProjectFormValues>(EMPTY_PROJECT_FORM);
  const [formData, setFormData] = useState<CreateTaskFormData>(() => createEmptyTaskForm());
  const [isCreating, setIsCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const utils = trpc.useUtils();

  const { data: project, isLoading: projectLoading } = trpc.project.getById.useQuery(
    { id: projectId },
    { enabled: Number.isFinite(projectId) && projectId > 0 },
  );

  const canViewTasks = Boolean(project?.canViewTasks);

  useEffect(() => {
    if (!projectLoading && project && !canViewTasks && selectedTask) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("task");
        return next;
      }, { replace: true });
    }
  }, [projectLoading, project, canViewTasks, selectedTask, setSearchParams]);

  const { data: taskData, isLoading: tasksLoading } = trpc.task.list.useQuery(
    { projectId, limit: 200 },
    {
      enabled:
        Number.isFinite(projectId) &&
        projectId > 0 &&
        (canViewTasks || projectLoading),
    },
  );

  const { data: usersData } = trpc.user.listForPicker.useQuery({ limit: 500 });
  const { data: projectsData } = trpc.project.listForPicker.useQuery();

  const addParticipantMutation = trpc.task.addParticipant.useMutation();
  const addObserverMutation = trpc.task.addObserver.useMutation();
  const createMutation = trpc.task.create.useMutation();
  const updateMutation = trpc.task.update.useMutation();
  const createSubtaskMutation = trpc.subtask.create.useMutation();
  const addCommentMutation = trpc.task.addComment.useMutation();
  const addAttachmentMutation = trpc.task.addAttachment.useMutation();

  const updateProjectMutation = trpc.project.update.useMutation({
    onSuccess: async () => {
      await utils.project.getById.invalidate({ id: projectId });
      await utils.project.list.invalidate();
      invalidateProjectStats(utils, projectId);
      setShowEditModal(false);
    },
  });

  const addPipelineStageMutation = trpc.project.addPipelineStage.useMutation({
    onSuccess: async (result) => {
      utils.project.getById.setData({ id: projectId }, (prev) =>
        prev
          ? {
              ...prev,
              customPipelineStages:
                result.customPipelineStages ??
                extractCustomPipelineStages(result.stages),
              pipelineStageOrder: result.pipelineStageOrder,
              pipelineStages: result.stages,
            }
          : prev,
      );
      await Promise.all([
        utils.project.getById.invalidate({ id: projectId }),
        utils.task.getById.invalidate(),
        utils.task.list.invalidate(),
      ]);
    },
  });

  const renamePipelineStageMutation = trpc.project.renamePipelineStage.useMutation({
    onSuccess: async (result) => {
      utils.project.getById.setData({ id: projectId }, (prev) =>
        prev
          ? {
              ...prev,
              pipelineStageLabelOverrides: result.pipelineStageLabelOverrides,
              pipelineStages: result.stages,
            }
          : prev,
      );
      await Promise.all([
        utils.project.getById.invalidate({ id: projectId }),
        utils.task.getById.invalidate(),
        utils.task.list.invalidate(),
      ]);
    },
  });

  const deletePipelineStageMutation = trpc.project.deletePipelineStage.useMutation({
    onSuccess: async (result) => {
      utils.project.getById.setData({ id: projectId }, (prev) =>
        prev
          ? {
              ...prev,
              customPipelineStages: result.customPipelineStages,
              pipelineStageLabelOverrides: result.pipelineStageLabelOverrides,
              hiddenPipelineStageKeys: result.hiddenPipelineStageKeys,
              pipelineStageOrder: result.pipelineStageOrder,
              pipelineStages: result.stages,
            }
          : prev,
      );
      await Promise.all([
        utils.project.getById.invalidate({ id: projectId }),
        utils.task.getById.invalidate(),
        utils.task.list.invalidate({ projectId, limit: 200 }),
      ]);
    },
  });

  const reorderPipelineStageMutation = trpc.project.reorderPipelineStage.useMutation({
    onSuccess: async (result) => {
      utils.project.getById.setData({ id: projectId }, (prev) =>
        prev
          ? {
              ...prev,
              pipelineStageOrder: result.pipelineStageOrder,
              pipelineStages: result.stages,
            }
          : prev,
      );
      await Promise.all([
        utils.project.getById.invalidate({ id: projectId }),
        utils.task.getById.invalidate(),
        utils.task.list.invalidate({ projectId, limit: 200 }),
      ]);
    },
  });

  const joinProjectMutation = trpc.project.join.useMutation({
    onSuccess: async () => {
      await utils.project.getById.invalidate({ id: projectId });
      await utils.task.list.invalidate({ projectId, limit: 200 });
    },
  });

  const bulkActionMutation = trpc.task.bulkAction.useMutation({
    onSuccess: async () => {
      setSelectedIds(new Set());
      await invalidateTaskQueries(utils);
      invalidateProjectStats(utils, projectId);
    },
  });

  const clientNameSuggestions = useMemo(
    () => collectClientNameSuggestions(projectsData ?? []),
    [projectsData],
  );

  const canManage =
    hasPermission(user, "projects.manage") ||
    (isClientPortalUser(user) && project?.createdBy === user?.id);
  const canCreate = canCreateTask(user);
  const canAddSection =
    canViewTasks &&
    (canManage ||
      canCreate ||
      user?.role === "manager" ||
      user?.role === "admin" ||
      hasPermission(user, "tasks.edit_all"));

  const pipelineStages = useMemo(() => {
    const p = project as {
      customPipelineStages?: Array<{ key: string; label: string; color: string }> | null;
      pipelineStageLabelOverrides?: Record<string, string> | null;
      hiddenPipelineStageKeys?: string[] | null;
      pipelineStageOrder?: string[] | null;
    } | null | undefined;
    return resolveProjectPipelineStages(p, orgLabelOverrides);
  }, [project, orgLabelOverrides]);
  const canBulkEdit =
    user?.role === "admin" ||
    user?.role === "manager" ||
    hasPermission(user, "tasks.edit_all") ||
    hasPermission(user, "tasks.edit_own");
  const canBulkDelete =
    user?.role === "admin" ||
    user?.role === "manager" ||
    hasPermission(user, "tasks.delete");
  const taskSelectionEnabled = canViewTasks && (canBulkEdit || canBulkDelete);
  const allTasks = canViewTasks ? (taskData?.tasks ?? []) : [];
  const userId = user?.id ?? 0;

  const searchContext = useMemo(
    () => ({
      users: usersData?.users ?? [],
      projects: project ? [{ id: project.id, name: project.name }] : [],
    }),
    [usersData?.users, project],
  );

  const filteredTasks = useMemo(() => {
    const next = applyTaskSearchFilters(
      allTasks,
      { ...DEFAULT_TASK_SEARCH_FILTERS, text: search },
      searchContext,
    );
    if (!priorityFilter) return next;
    return next.filter((task) => task.priority === priorityFilter);
  }, [allTasks, search, searchContext, priorityFilter]);

  const { highlightedTaskId } = useLocateTaskInView([
    taskView,
    filteredTasks.length,
    search,
    priorityFilter,
  ]);

  const doneTaskCount = useMemo(
    () => allTasks.filter((task) => isCompletedTask(task)).length,
    [allTasks],
  );

  const stats = useMemo(() => {
    if (!canViewTasks && project?.stats) {
      return project.stats;
    }
    return computeProjectStatsFromTasks(allTasks);
  }, [allTasks, canViewTasks, project?.stats]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredTasks.map((t) => t.id);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const runBulkAction = (
    action: "delete" | "status" | "move_project",
    extra?: { status?: "todo" | "in_progress" | "review" | "done"; projectId?: number | null },
  ) => {
    if (selectedIds.size === 0) return;
    bulkActionMutation.mutate({
      taskIds: [...selectedIds],
      action,
      ...extra,
    });
  };

  const openTask = (taskId: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("task", String(taskId));
      next.delete("activity");
      return next;
    });
  };

  const closeTask = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("task");
      next.delete("activity");
      return next;
    });
  };

  const clearActivityHighlight = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("activity");
      return next;
    }, { replace: true });
  };

  const setTaskView = (view: ProjectTaskView) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === "list") next.set("view", "list");
      else next.delete("view"); // Kanban is the default project task view
      return next;
    });
  };

  const openEdit = () => {
    if (!project) return;
    setEditForm(projectToFormValues(project));
    setShowEditModal(true);
  };

  const openCreateModal = (stage?: ProjectPipelineStageKey) => {
    tryOpenCreateTask(user, () => {
      setFormData(
        createEmptyTaskForm({
          assigneeId: user?.id,
          ownerId: user?.id,
          projectId,
          stage,
        }),
      );
      setShowCreateModal(true);
    });
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setFormData(createEmptyTaskForm());
    resetStagingMediaIds();
  };

  const handleCreate = async () => {
    if (!formData.title.trim()) return;

    const tasksById = new Map(allTasks.map((t) => [t.id, t.title]));

    setIsCreating(true);
    try {
      await submitCreateTask({
        formData,
        createMutation,
        addParticipantMutation,
        addObserverMutation,
        updateMutation,
        createSubtaskMutation,
        addCommentMutation,
        addAttachmentMutation,
        tasksById,
      });

      await utils.task.list.invalidate();
      invalidateProjectStats(utils, projectId);
      closeCreateModal();
    } catch (error) {
      console.error("Failed to create task:", error);
      window.alert(error instanceof Error ? error.message : "Failed to create task. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  if (!Number.isFinite(projectId) || projectId <= 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-500">Invalid project.</p>
        <Link to={projectsBackPath} className="text-[#2563EB] text-sm mt-2 inline-block">Back to projects</Link>
      </div>
    );
  }

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-500">Project not found.</p>
        <Link to={projectsBackPath} className="text-[#2563EB] text-sm mt-2 inline-block">Back to projects</Link>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 overflow-x-hidden">
      {canViewTasks ? (
        <ProjectKanbanHeader
          name={project.name}
          clientName={clientPortal ? null : project.clientName}
          totalTasks={allTasks.length}
          doneTasks={doneTaskCount}
          search={search}
          onSearchChange={setSearch}
          priority={priorityFilter}
          onPriorityChange={setPriorityFilter}
          canCreate={canCreate}
          onAddTask={canCreate ? () => openCreateModal() : undefined}
          canEdit={canManage}
          onEdit={openEdit}
          backTo={projectsBackPath}
          taskView={taskView}
          onTaskViewChange={setTaskView}
        />
      ) : (
        <ProjectHeaderCard
          name={project.name}
          description={project.description}
          clientName={clientPortal ? null : project.clientName}
          stats={stats}
          memberCount={project.memberCount ?? 1}
          creatorName={project.creator?.name ?? null}
          canEdit={canManage}
          canViewTasks={canViewTasks}
          onEdit={openEdit}
          onAddTask={canCreate && canViewTasks ? () => openCreateModal() : undefined}
          onJoinProject={
            !canViewTasks
              ? () => joinProjectMutation.mutate({ projectId })
              : undefined
          }
          joinPending={joinProjectMutation.isPending}
          backTo={projectsBackPath}
        />
      )}

      {!canViewTasks ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 px-6 text-center">
          <UserPlus size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-semibold text-[#1F2937] mb-2">
            Join this project to view tasks
          </h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            You can browse project details here. Tasks and the task board are only visible after
            you join the project team.
          </p>
          <button
            type="button"
            onClick={() => joinProjectMutation.mutate({ projectId })}
            disabled={joinProjectMutation.isPending}
            className="inline-flex items-center gap-2 h-10 px-5 bg-[#2563EB] text-white rounded-lg text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {joinProjectMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <UserPlus size={16} />
            )}
            Join Project
          </button>
        </div>
      ) : (
        <>
      {taskView === "list" && taskSelectionEnabled ? (
        <TaskBulkActionBar
          selectedCount={selectedIds.size}
          canBulkEdit={canBulkEdit}
          canBulkDelete={canBulkDelete}
          projects={(projectsData ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color ?? null,
          }))}
          excludeProjectId={projectId}
          isPending={bulkActionMutation.isPending}
          onChangeStatus={(status) => runBulkAction("status", { status })}
          onMoveProject={(nextProjectId) =>
            runBulkAction("move_project", { projectId: nextProjectId })
          }
          onDelete={() => {
            if (!window.confirm(`Delete ${selectedIds.size} task(s)? This cannot be undone.`)) {
              return;
            }
            runBulkAction("delete");
          }}
          onClear={() => setSelectedIds(new Set())}
        />
      ) : null}

      {taskView === "list" ? (
        <TaskListView
          tasks={filteredTasks}
          isLoading={tasksLoading}
          onTaskClick={openTask}
          emptyMessage="No tasks in this project yet."
          selectable={taskSelectionEnabled}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          highlightedTaskId={highlightedTaskId}
          projectId={projectId}
          stages={pipelineStages}
          groupByStage
        />
      ) : (
        <TaskKanbanBoard
          tasks={filteredTasks}
          isLoading={tasksLoading}
          onTaskClick={openTask}
          canCreate={canCreate && canViewTasks}
          projectId={projectId}
          onCreateClick={canCreate && canViewTasks ? openCreateModal : undefined}
          highlightedTaskId={highlightedTaskId}
          stages={pipelineStages}
          className="h-[calc(100vh-18rem)] md:h-[calc(100vh-16rem)] xl:h-[calc(100vh-9.75rem)]"
          canAddSection={canAddSection}
          addingSection={addPipelineStageMutation.isPending}
          onAddSection={
            canAddSection
              ? async (label) => {
                  await addPipelineStageMutation.mutateAsync({ projectId, label });
                }
              : undefined
          }
          canRenameSection={canAddSection}
          renamingSection={renamePipelineStageMutation.isPending}
          onRenameSection={
            canAddSection
              ? async (key, label) => {
                  await renamePipelineStageMutation.mutateAsync({ projectId, key, label });
                }
              : undefined
          }
          canDeleteSection={canAddSection}
          deletingSection={deletePipelineStageMutation.isPending}
          onDeleteSection={
            canAddSection
              ? async (key) => {
                  await deletePipelineStageMutation.mutateAsync({ projectId, key });
                }
              : undefined
          }
          canReorderSection={canAddSection}
          reorderingSection={reorderPipelineStageMutation.isPending}
          onReorderSection={
            canAddSection
              ? async (key, direction) => {
                  await reorderPipelineStageMutation.mutateAsync({
                    projectId,
                    key,
                    direction,
                  });
                }
              : undefined
          }
        />
      )}
        </>
      )}

      <AnimatePresence>
        {selectedTask && (
          <TaskDetailPanel
            taskId={selectedTask}
            highlightActivityId={highlightActivityId}
            onHighlightDone={clearActivityHighlight}
            onClose={closeTask}
            onTaskOpen={openTask}
            pipelineStages={pipelineStages}
          />
        )}
      </AnimatePresence>

      <CreateTaskModal
        open={showCreateModal}
        onClose={closeCreateModal}
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleCreate}
        isSubmitting={isCreating}
        users={usersData?.users ?? []}
        projects={projectsData ?? []}
        tasks={allTasks.map((t) => ({ id: t.id, title: t.title }))}
        currentUser={
          user
            ? { id: user.id, name: user.name, avatar: user.avatar }
            : null
        }
        pipelineStages={pipelineStages}
      />

      <ModalBackdrop open={showEditModal} onClose={() => setShowEditModal(false)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-[#1F2937]">Edit Project</h2>
            <button type="button" onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editForm.name.trim()) return;
              updateProjectMutation.mutate({
                id: projectId,
                name: editForm.name,
                description: editForm.description || undefined,
                clientName: clientPortal ? null : editForm.clientName.trim() || null,
                color: editForm.color,
                icon: editForm.icon,
              });
            }}
            className="p-5 space-y-4"
          >
            <ProjectFormFields
              value={editForm}
              onChange={setEditForm}
              clientNameSuggestions={clientNameSuggestions}
              idPrefix="edit-project"
              hideClientAgency={clientPortal}
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="h-10 px-4 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateProjectMutation.isPending}
                className="h-10 px-4 bg-[#2563EB] text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                {updateProjectMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Save
              </button>
            </div>
          </form>
        </motion.div>
      </ModalBackdrop>
    </motion.div>
  );
}
