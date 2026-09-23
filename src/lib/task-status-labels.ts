export const TASK_DB_STATUS_KEYS = ["todo", "in_progress", "review", "done"] as const;
export const TASK_STATUS_LABEL_KEYS = [...TASK_DB_STATUS_KEYS, "deferred"] as const;

export type TaskDbStatus = (typeof TASK_DB_STATUS_KEYS)[number];
export type TaskStatusLabelKey = (typeof TASK_STATUS_LABEL_KEYS)[number];
export type TaskStatusLabels = Record<TaskStatusLabelKey, string>;

export const DEFAULT_TASK_STATUS_LABELS: TaskStatusLabels = {
  todo: "Not started",
  in_progress: "In Progress",
  review: "Pause",
  done: "Complete",
  deferred: "Defer",
};

export const TASK_STATUS_EDITOR_FIELDS: Array<{
  key: TaskStatusLabelKey;
  defaultLabel: string;
  description: string;
}> = [
  {
    key: "todo",
    defaultLabel: DEFAULT_TASK_STATUS_LABELS.todo,
    description: "Tasks that have not begun yet.",
  },
  {
    key: "in_progress",
    defaultLabel: DEFAULT_TASK_STATUS_LABELS.in_progress,
    description: "Tasks currently being worked on.",
  },
  {
    key: "review",
    defaultLabel: DEFAULT_TASK_STATUS_LABELS.review,
    description: "Tasks that are paused.",
  },
  {
    key: "done",
    defaultLabel: DEFAULT_TASK_STATUS_LABELS.done,
    description: "Finished tasks.",
  },
  {
    key: "deferred",
    defaultLabel: DEFAULT_TASK_STATUS_LABELS.deferred,
    description: "Tasks postponed for later.",
  },
];

const LABEL_MAX_LENGTH = 40;

export function mergeTaskStatusLabels(
  overrides?: Partial<TaskStatusLabels> | null,
): TaskStatusLabels {
  const next = { ...DEFAULT_TASK_STATUS_LABELS };
  for (const key of TASK_STATUS_LABEL_KEYS) {
    const value = overrides?.[key]?.trim();
    if (value) next[key] = value.slice(0, LABEL_MAX_LENGTH);
  }
  return next;
}

export function dbStatusLabel(
  status: string,
  labels: TaskStatusLabels = DEFAULT_TASK_STATUS_LABELS,
) {
  if (status in labels) return labels[status as TaskStatusLabelKey];
  return status;
}

export function taskDbStatusFilterOptions(labels: TaskStatusLabels) {
  return [
    { value: "", label: "All Status" },
    ...TASK_DB_STATUS_KEYS.map((key) => ({ value: key, label: labels[key] })),
  ];
}

export function taskBulkStatusOptions(labels: TaskStatusLabels) {
  return TASK_DB_STATUS_KEYS.map((key) => ({ value: key, label: labels[key] }));
}

export function assignedTaskStatusCountRows(
  counts: Record<TaskDbStatus, number>,
  labels: TaskStatusLabels,
) {
  return TASK_DB_STATUS_KEYS.map((status) => ({
    name: labels[status],
    value: counts[status],
    status,
  }));
}
