import { hasPermission } from "@/lib/permissions";

export const CREATE_TASK_PERMISSION = "tasks.create";

export const CREATE_TASK_DENIED_MESSAGE =
  "You don't have permission to create tasks.";

export function canCreateTask(
  user: Parameters<typeof hasPermission>[0],
) {
  return hasPermission(user, CREATE_TASK_PERMISSION);
}

export function notifyCreateTaskDenied() {
  window.alert(CREATE_TASK_DENIED_MESSAGE);
}

/** Runs `onAllowed` only when the user may create tasks; otherwise shows a popup. */
export function tryOpenCreateTask(
  user: Parameters<typeof hasPermission>[0],
  onAllowed: () => void,
): boolean {
  if (!canCreateTask(user)) {
    notifyCreateTaskDenied();
    return false;
  }
  onAllowed();
  return true;
}
