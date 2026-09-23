import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { TaskKanbanBoard } from "@/components/tasks/TaskKanbanBoard";
import { TaskListView } from "@/components/tasks/TaskListView";
import { TaskViewToolbar, type TaskView } from "@/components/tasks/TaskViewToolbar";
import {
  CreateTaskModal,
  createEmptyTaskForm,
  type CreateTaskFormData,
} from "@/components/tasks/CreateTaskModal";
import {
  consumeTaskCreatePrefill,
} from "@/lib/task-create-prefill";
import { resetStagingMediaIds } from "@/lib/staged-task-media";
import { submitCreateTask } from "@/lib/submit-create-task";
import {
  buildMyTasksViewPath,
  parseActivityIdParam,
  parseTaskKeyParam,
} from "@/lib/task-notification-link";
import {
  canCreateTask,
  notifyCreateTaskDenied,
  tryOpenCreateTask,
} from "@/lib/create-task-permission";
import { getTaskBulkPermissions } from "@/lib/task-bulk-permissions";
import { invalidateProjectStats } from "@/lib/project-stats";
import { invalidateTaskQueries } from "@/lib/invalidate-on-notifications";
import { TaskBulkActionBar } from "@/components/tasks/TaskBulkActionBar";
import type { ProjectPipelineStageKey } from "@/lib/task-kanban";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { ListPaginationControls } from "@/components/shared/ListPaginationControls";
import { LIST_PAGE_SIZE, paginateItems } from "@/lib/list-pagination";

const VALID_VIEWS: TaskView[] = ["list", "kanban"];

function parseView(raw: string | null): TaskView {
  if (raw === "deadline" || raw === "planner" || raw === "calendar" || raw === "gantt" || raw === "observer") {
    return "kanban";
  }
  if (raw && VALID_VIEWS.includes(raw as TaskView)) return raw as TaskView;
  return "list";
}

type TaskRow = {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  stage?: string | null;
  priority: string;
  assigneeId?: number | null;
  createdBy?: number | null;
  projectId?: number | null;
  participantIds?: number[];
  observerIds?: number[];
  dueDate?: string | Date | null;
  actualHours?: string | null;
  project?: { id: number; name: string } | null;
  assignee?: {
    name: string | null;
    avatar?: string | null;
    role?: string;
  } | null;
};

export default function Tasks() {
  return <TasksWebPage />;
}

function TasksWebPage() {
  const navigate = useNavigate();
  const { taskId: legacyTaskIdParam, taskKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const view = parseView(searchParams.get("view"));
  const userId = user?.id ?? 0;
  const isInvitedClient = String(user?.role ?? "").toLowerCase() === "client";

  const [formData, setFormData] = useState<CreateTaskFormData>(() => createEmptyTaskForm());
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [cloneSourceTitle, setCloneSourceTitle] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const highlightActivityId = useMemo(
    () => parseActivityIdParam(searchParams.get("activity")),
    [searchParams],
  );

  useEffect(() => {
    const legacyView = searchParams.get("view");
    if (
      legacyView === "deadline" ||
      legacyView === "planner" ||
      legacyView === "calendar" ||
      legacyView === "gantt" ||
      legacyView === "observer"
    ) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", "kanban");
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("view") === "chats") {
      const task =
        parseTaskKeyParam(taskKey) ||
        (legacyTaskIdParam ? Number(legacyTaskIdParam) : null) ||
        searchParams.get("task");
      navigate(task ? `/task-chats?task=${task}` : "/task-chats", { replace: true });
    }
  }, [searchParams, navigate, taskKey, legacyTaskIdParam]);

  useEffect(() => {
    const fromKey = parseTaskKeyParam(taskKey);
    const fromLegacy = legacyTaskIdParam ? Number(legacyTaskIdParam) : null;
    const pathTaskId =
      fromKey ??
      (fromLegacy && Number.isFinite(fromLegacy) && fromLegacy > 0 ? fromLegacy : null);

    if (pathTaskId) {
      setSelectedTask(pathTaskId);
      return;
    }

    const taskParam = searchParams.get("task");
    if (taskParam) {
      const id = Number(taskParam);
      if (Number.isFinite(id) && id > 0) {
        const activity = parseActivityIdParam(searchParams.get("activity"));
        navigate(buildMyTasksViewPath(id, activity), { replace: true });
        return;
      }
    }

    setSelectedTask(null);
  }, [taskKey, legacyTaskIdParam, searchParams, navigate]);

  useEffect(() => {
    if (searchParams.get("create") !== "true" || !user?.id) return;

    const clearCreateParams = () => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("create");
        next.delete("from");
        return next;
      }, { replace: true });
    };

    if (!canCreateTask(user)) {
      notifyCreateTaskDenied();
      clearCreateParams();
      return;
    }

    const from = searchParams.get("from");
    const prefill =
      from === "template" || from === "clone" ? consumeTaskCreatePrefill() : null;

    if (from === "clone" && prefill) {
      setCloneSourceTitle(prefill.sourceTitle);
    } else {
      setCloneSourceTitle(null);
    }

    resetStagingMediaIds();
    setFormData(
      createEmptyTaskForm({
        ...prefill?.form,
        assigneeId: prefill?.form.assigneeId ?? (isInvitedClient ? undefined : user.id),
        ownerId: prefill?.form.ownerId ?? user.id,
        stage: prefill?.form.stage ?? "new",
      }),
    );
    setShowCreateModal(true);
    clearCreateParams();
  }, [searchParams, user, isInvitedClient, setSearchParams]);

  const setView = (next: TaskView) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("view", next);
      return p;
    });
  };

  const closeTask = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    next.delete("activity");
    const qs = next.toString();
    navigate(`/tasks${qs ? `?${qs}` : ""}`);
  };

  const clearActivityHighlight = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("activity");
      return next;
    }, { replace: true });
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCloneSourceTitle(null);
    setFormData(createEmptyTaskForm());
    resetStagingMediaIds();
  };

  const openCreateModal = (stage?: ProjectPipelineStageKey) => {
    tryOpenCreateTask(user, () => {
      resetStagingMediaIds();
      setCloneSourceTitle(null);
      setFormData(
        createEmptyTaskForm({
          assigneeId: isInvitedClient ? undefined : user?.id,
          ownerId: user?.id,
          stage: stage ?? "new",
        }),
      );
      setShowCreateModal(true);
    });
  };

  const listInput = useMemo(
    () =>
      isInvitedClient
        ? { limit: 200 }
        : { assigneeId: userId, limit: 200 },
    [isInvitedClient, userId],
  );

  const { data: taskData, isLoading } = trpc.task.list.useQuery(listInput, {
    enabled: userId > 0,
  });

  const { data: usersData } = trpc.user.listForPicker.useQuery({ limit: 500 });
  const { data: projectsData } = trpc.project.listForPicker.useQuery();

  const utils = trpc.useUtils();
  const addParticipantMutation = trpc.task.addParticipant.useMutation();
  const addObserverMutation = trpc.task.addObserver.useMutation();
  const createMutation = trpc.task.create.useMutation();
  const updateMutation = trpc.task.update.useMutation();
  const createSubtaskMutation = trpc.subtask.create.useMutation();
  const addCommentMutation = trpc.task.addComment.useMutation();
  const addAttachmentMutation = trpc.task.addAttachment.useMutation();

  const bulkActionMutation = trpc.task.bulkAction.useMutation({
    onSuccess: async () => {
      setSelectedIds(new Set());
      await invalidateTaskQueries(utils);
      invalidateProjectStats(utils);
    },
  });

  const canCreate = canCreateTask(user);
  const { canBulkEdit, canBulkDelete, taskSelectionEnabled } = getTaskBulkPermissions(user);
  const myTasks = (taskData?.tasks ?? []) as TaskRow[];

  const taskPagination = useMemo(
    () => paginateItems(myTasks, page, LIST_PAGE_SIZE),
    [myTasks, page],
  );
  const paginatedTasks = taskPagination.items;

  useEffect(() => {
    if (page > taskPagination.totalPages) {
      setPage(taskPagination.totalPages);
    }
  }, [page, taskPagination.totalPages]);

  const openTask = (id: number) => {
    navigate(buildMyTasksViewPath(id));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = paginatedTasks.map((t) => t.id);
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

  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!formData.title.trim()) return;

    const tasksById = new Map(myTasks.map((t) => [t.id, t.title]));

    setIsCreating(true);
    try {
      await submitCreateTask({
        formData,
        cloneSourceTitle,
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
      closeCreateModal();
    } catch (error) {
      console.error("Failed to create task:", error);
      window.alert(error instanceof Error ? error.message : "Failed to create task. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">My Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isInvitedClient
              ? "Tasks you created or that are assigned to you"
              : "Tasks assigned to you"}
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => openCreateModal()}
            className="h-9 px-4 bg-[#2563EB] text-white rounded-lg text-sm font-semibold hover:bg-[#1D4ED8] flex items-center gap-2 shrink-0"
          >
            <Plus size={16} />
            Add Task
          </button>
        ) : null}
      </div>

      {/* <TaskViewToolbar view={view} onViewChange={setView} /> */}

      {view === "list" && (
        <>
          <TaskBulkActionBar
            selectedCount={selectedIds.size}
            canBulkEdit={canBulkEdit}
            canBulkDelete={canBulkDelete}
            projects={(projectsData ?? []).map((p) => ({ id: p.id, name: p.name }))}
            isPending={bulkActionMutation.isPending}
            onChangeStatus={(status) => runBulkAction("status", { status })}
            onMoveProject={(projectId) => runBulkAction("move_project", { projectId })}
            onDelete={() => {
              if (!window.confirm(`Delete ${selectedIds.size} task(s)? This cannot be undone.`)) {
                return;
              }
              runBulkAction("delete");
            }}
            onClear={() => setSelectedIds(new Set())}
          />
          <TaskListView
            tasks={paginatedTasks}
            isLoading={isLoading}
            onTaskClick={openTask}
            selectable={taskSelectionEnabled}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            listQueryInput={listInput}
            allowProjectEdit
            projects={projectsData ?? []}
          />

          <ListPaginationControls
            page={taskPagination.page}
            totalPages={taskPagination.totalPages}
            totalItems={taskPagination.totalItems}
            startIndex={taskPagination.startIndex}
            endIndex={taskPagination.endIndex}
            onPageChange={(nextPage) => {
              setPage(nextPage);
            }}
          />
        </>
      )}

      {view === "kanban" && (
        <TaskKanbanBoard
          tasks={myTasks}
          isLoading={isLoading}
          onTaskClick={openTask}
          listQueryInput={listInput}
          canCreate={canCreate}
          onCreateClick={canCreate ? openCreateModal : undefined}
        />
      )}

      <CreateTaskModal
        open={showCreateModal}
        onClose={closeCreateModal}
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleCreate}
        isSubmitting={isCreating}
        users={usersData?.users ?? []}
        projects={projectsData ?? []}
        tasks={myTasks.map((t) => ({ id: t.id, title: t.title }))}
        currentUser={
          user
            ? { id: user.id, name: user.name, avatar: user.avatar, role: user.role }
            : null
        }
        lockOwner={isInvitedClient}
      />

      <AnimatePresence>
        {selectedTask && (
          <TaskDetailPanel
            taskId={selectedTask}
            highlightActivityId={highlightActivityId}
            onHighlightDone={clearActivityHighlight}
            onClose={closeTask}
            onTaskOpen={openTask}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
