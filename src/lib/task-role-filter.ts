export type TaskRoleFilter = "all" | "ongoing" | "assisting" | "set_by_me" | "following";

export const TASK_ROLE_OPTIONS: { id: TaskRoleFilter; label: string }[] = [
  { id: "all", label: "All roles" },
  { id: "ongoing", label: "Ongoing" },
  { id: "assisting", label: "Assisting" },
  { id: "set_by_me", label: "Set by me" },
  { id: "following", label: "Observer" },
];

export type TaskForRoleFilter = {
  id: number;
  assigneeId?: number | null;
  createdBy?: number | null;
  status: string;
  participantIds?: number[];
  observerIds?: number[];
};

function isParticipant(task: TaskForRoleFilter, userId: number) {
  return task.participantIds?.includes(userId) ?? false;
}

function isObserver(task: TaskForRoleFilter, userId: number) {
  return task.observerIds?.includes(userId) ?? false;
}

/** Tasks the current user is involved in (any relationship). */
export function isUserInvolvedInTask(task: TaskForRoleFilter, userId: number) {
  return (
    task.assigneeId === userId ||
    task.createdBy === userId ||
    isParticipant(task, userId) ||
    isObserver(task, userId)
  );
}

export function matchesTaskRoleFilter(
  task: TaskForRoleFilter,
  filter: TaskRoleFilter,
  userId: number,
) {
  switch (filter) {
    case "all":
      return isUserInvolvedInTask(task, userId);
    case "ongoing":
      return task.assigneeId === userId && task.status !== "done";
    case "assisting":
      return isParticipant(task, userId) && task.assigneeId !== userId;
    case "set_by_me":
      return task.createdBy === userId;
    case "following":
      return isObserver(task, userId);
    default:
      return true;
  }
}

export function countTasksByRoleFilter(
  tasks: TaskForRoleFilter[],
  userId: number,
): Record<TaskRoleFilter, number> {
  const counts: Record<TaskRoleFilter, number> = {
    all: 0,
    ongoing: 0,
    assisting: 0,
    set_by_me: 0,
    following: 0,
  };

  for (const option of TASK_ROLE_OPTIONS) {
    counts[option.id] = tasks.filter((t) =>
      matchesTaskRoleFilter(t, option.id, userId)
    ).length;
  }

  return counts;
}

export function filterTasksByRole(
  tasks: TaskForRoleFilter[],
  filter: TaskRoleFilter,
  userId: number,
) {
  if (!userId) return tasks;
  return tasks.filter((t) => matchesTaskRoleFilter(t, filter, userId));
}
