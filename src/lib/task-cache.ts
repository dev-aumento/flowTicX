import type { trpc } from "@/providers/trpc";
import { legacyStatusToStage, isMarkingTaskComplete } from "@/lib/task-kanban";

type TrpcUtils = ReturnType<typeof trpc.useUtils>;

type TaskLike = {
  id: number;
  status: string;
  stage?: string | null;
};

type TaskListData = {
  tasks: TaskLike[];
  total: number;
};

type TaskUpdateInput = {
  id: number;
  title?: string;
  status?: "todo" | "in_progress" | "review" | "done";
  stage?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  assigneeId?: number | null;
  createdBy?: number | null;
  projectId?: number | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  description?: string;
};

type DashboardStats = {
  ongoingTasks: number;
  completedTasks: number;
  hoursTracked: number;
};

/** Mirror API `task.update` patch rules for optimistic UI. */
export function resolveOptimisticTaskPatch(
  current: Pick<TaskLike, "status" | "stage">,
  update: TaskUpdateInput,
) {
  const patch: Record<string, unknown> = {};

  if (update.title !== undefined) patch.title = update.title.trim();
  if (update.description !== undefined) patch.description = update.description;
  if (update.priority !== undefined) patch.priority = update.priority;
  if (update.assigneeId !== undefined) patch.assigneeId = update.assigneeId;
  if (update.createdBy !== undefined) patch.createdBy = update.createdBy;
  if (update.projectId !== undefined) patch.projectId = update.projectId;
  if (update.dueDate !== undefined) patch.dueDate = update.dueDate;
  if (update.estimatedHours !== undefined) patch.estimatedHours = update.estimatedHours;

  if (update.stage) {
    patch.stage = update.stage;
    if (update.stage === "finished") {
      patch.status = "done";
    } else if (current.status === "done" && update.status === undefined) {
      patch.status = "in_progress";
    }
  }

  if (update.status !== undefined) {
    patch.status = update.status;
    if (update.stage === undefined) {
      patch.stage = legacyStatusToStage(update.status);
    }
  }

  // Completing a task clears assignee in the API — mirror that for optimistic UI.
  if (isMarkingTaskComplete(update)) {
    patch.assigneeId = null;
    patch.assignee = null;
  }

  return patch;
}

export function patchTaskInListCaches(
  utils: TrpcUtils,
  taskId: number,
  patch: Record<string, unknown>,
) {
  utils.task.list.setQueriesData({}, (old) => {
    if (!old || typeof old !== "object" || !("tasks" in old)) return old;
    const data = old as TaskListData;
    return {
      ...data,
      tasks: data.tasks.map((task) =>
        task.id === taskId ? { ...task, ...patch } : task,
      ),
    };
  });
}

export function patchTaskByIdCache(
  utils: TrpcUtils,
  taskId: number,
  patch: Record<string, unknown>,
) {
  utils.task.getById.setData({ id: taskId }, (old) => {
    if (!old) return old;
    return { ...old, ...patch };
  });
}

export function patchDashboardStatsForTaskChange(
  utils: TrpcUtils,
  before: Pick<TaskLike, "status" | "stage">,
  after: Pick<TaskLike, "status" | "stage">,
) {
  utils.dashboard.getStats.setQueriesData({}, (old) => {
    if (!old || typeof old !== "object") return old;
    const stats = old as DashboardStats;

    // Match dashboard.getStats: count by status, not pipeline stage.
    const wasTodo = before.status === "todo";
    const isTodo = after.status === "todo";
    const wasCompleted = before.status === "done";
    const isCompleted = after.status === "done";

    let ongoingTasks = stats.ongoingTasks;
    let completedTasks = stats.completedTasks;

    if (!wasTodo && isTodo) ongoingTasks += 1;
    if (wasTodo && !isTodo) ongoingTasks -= 1;
    if (!wasCompleted && isCompleted) completedTasks += 1;
    if (wasCompleted && !isCompleted) completedTasks -= 1;

    return {
      ...stats,
      ongoingTasks: Math.max(0, ongoingTasks),
      completedTasks: Math.max(0, completedTasks),
    };
  });
}

export async function applyOptimisticTaskUpdate(
  utils: TrpcUtils,
  current: TaskLike,
  update: TaskUpdateInput,
) {
  await Promise.all([
    utils.task.list.cancel(),
    utils.task.getById.cancel({ id: current.id }),
  ]);

  const patch = resolveOptimisticTaskPatch(current, update);
  if (Object.keys(patch).length === 0) return;

  patchTaskInListCaches(utils, current.id, patch);
  patchTaskByIdCache(utils, current.id, patch);

  if (update.status !== undefined || update.stage !== undefined) {
    patchDashboardStatsForTaskChange(utils, current, {
      status: String(patch.status ?? current.status),
      stage: (patch.stage as string | null | undefined) ?? current.stage,
    });
  }
}
