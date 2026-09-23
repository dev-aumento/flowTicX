import {
  DEFAULT_TASK_STATUS_LABELS,
  type TaskStatusLabels,
} from "@/lib/task-status-labels";

export type WorkflowState =
  | "not_started"
  | "in_progress"
  | "paused"
  | "deferred"
  | "complete";

export type DbTaskStatus = "todo" | "in_progress" | "review" | "done";

export function workflowLabelsFromTaskStatus(
  labels: TaskStatusLabels = DEFAULT_TASK_STATUS_LABELS,
): Record<WorkflowState, string> {
  return {
    not_started: labels.todo,
    in_progress: labels.in_progress,
    paused: labels.review,
    deferred: labels.deferred,
    complete: labels.done,
  };
}

export const WORKFLOW_LABELS: Record<WorkflowState, string> =
  workflowLabelsFromTaskStatus();

export function resolveWorkflowState(
  taskStatus: string,
  isDeferred: boolean,
): WorkflowState {
  if (taskStatus === "done") return "complete";
  if (isDeferred) return "deferred";
  if (taskStatus === "in_progress") return "in_progress";
  if (taskStatus === "review") return "paused";
  return "not_started";
}

export function workflowStateToDb(state: WorkflowState): {
  status: DbTaskStatus;
  deferred: boolean;
} {
  switch (state) {
    case "in_progress":
      return { status: "in_progress", deferred: false };
    case "paused":
      return { status: "review", deferred: false };
    case "deferred":
      return { status: "review", deferred: true };
    case "complete":
      return { status: "done", deferred: false };
    default:
      return { status: "todo", deferred: false };
  }
}

/** Options shown in the status dropdown for the current workflow state. */
export function getWorkflowTransitions(
  state: WorkflowState,
  labels: TaskStatusLabels = DEFAULT_TASK_STATUS_LABELS,
): { value: WorkflowState; label: string }[] {
  const names = workflowLabelsFromTaskStatus(labels);
  switch (state) {
    case "not_started":
      return [{ value: "in_progress", label: names.in_progress }];
    case "in_progress":
      return [
        { value: "paused", label: names.paused },
        { value: "deferred", label: names.deferred },
      ];
    case "paused":
      return [
        { value: "in_progress", label: names.in_progress },
        { value: "complete", label: names.complete },
      ];
    case "deferred":
      return [{ value: "in_progress", label: names.in_progress }];
    case "complete":
      return [{ value: "in_progress", label: names.in_progress }];
  }
}

export function workflowLabel(
  state: WorkflowState,
  labels: TaskStatusLabels = DEFAULT_TASK_STATUS_LABELS,
): string {
  return workflowLabelsFromTaskStatus(labels)[state];
}
