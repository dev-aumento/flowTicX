export type ProjectTaskStats = {
  total: number;
  todo: number;
  inProgress: number;
  review: number;
  done: number;
};

type TaskWithStatus = { status: string };

export function computeProjectStatsFromTasks(tasks: TaskWithStatus[]): ProjectTaskStats {
  return {
    total: tasks.length,
    todo: tasks.filter((t) => t.status === "todo").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    review: tasks.filter((t) => t.status === "review").length,
    done: tasks.filter((t) => t.status === "done").length,
  };
}

export function projectProgressPercent(stats: ProjectTaskStats): number {
  if (stats.total === 0) return 0;
  return Math.round((stats.done / stats.total) * 100);
}

type TaskWithHours = { actualHours?: string | null };

export function computeProjectHoursTracked(tasks: TaskWithHours[]): number {
  const total = tasks.reduce(
    (sum, t) => sum + parseFloat(String(t.actualHours ?? "0")),
    0,
  );
  return Math.round(total * 10) / 10;
}

type TrpcUtils = {
  project: {
    list: { invalidate: () => void };
    getById: { invalidate: (input: { id: number }) => void };
  };
};

export function invalidateProjectStats(utils: TrpcUtils, projectId?: number | null) {
  utils.project.list.invalidate();
  if (projectId) utils.project.getById.invalidate({ id: projectId });
}
