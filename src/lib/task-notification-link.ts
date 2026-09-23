/** Slug for project URLs, e.g. "BD Noho Nails" → "bd-noho-nails" */
export function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "project";
}

/**
 * Shared / copied task path (includes project slug when available):
 *   /projects/bd-noho-nails/tasks/task=56/
 * Fallback when no project:
 *   /tasks/task=56/
 */
export function buildTaskViewPath(options: {
  taskId: number;
  projectName?: string | null;
  activityId?: number | null;
}) {
  const { taskId, projectName, activityId } = options;
  const trimmed = projectName?.trim();
  const base = trimmed
    ? `/projects/${slugifyProjectName(trimmed)}/tasks/task=${taskId}/`
    : `/tasks/task=${taskId}/`;

  if (activityId != null && activityId > 0) {
    return `${base}?activity=${activityId}`;
  }
  return base;
}

/** In-app My Tasks URL — keeps "My tasks" nav active. */
export function buildMyTasksViewPath(taskId: number, activityId?: number | null) {
  return buildTaskViewPath({ taskId, activityId });
}

/** In-app All Tasks URL — keeps "All tasks" nav active. */
export function buildAllTasksViewPath(taskId: number, activityId?: number | null) {
  return buildAdminTaskListPath("/admin/tasks", taskId, activityId);
}

/** Task URL the current user can actually open (All tasks vs My tasks). */
export function buildAccessibleTaskViewPath(
  canViewAll: boolean,
  taskId: number,
  activityId?: number | null,
) {
  return canViewAll
    ? buildAllTasksViewPath(taskId, activityId)
    : buildMyTasksViewPath(taskId, activityId);
}

/** Tasks clients assigned to staff — keeps "Client's Tasks" nav active. */
export function buildClientTasksViewPath(taskId: number, activityId?: number | null) {
  return buildAdminTaskListPath("/admin/client-tasks", taskId, activityId);
}

export function buildAdminTaskListPath(
  basePath: "/admin/tasks" | "/admin/client-tasks",
  taskId: number,
  activityId?: number | null,
) {
  const base = `${basePath}/task=${taskId}/`;
  if (activityId != null && activityId > 0) {
    return `${base}?activity=${activityId}`;
  }
  return base;
}

export function buildTaskNotificationLink(taskId: number, activityId?: number | null) {
  return buildMyTasksViewPath(taskId, activityId);
}

export function buildAbsoluteTaskViewUrl(
  taskId: number,
  projectName?: string | null,
) {
  const path = buildTaskViewPath({ taskId, projectName });
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export function parseActivityIdParam(raw: string | null): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Parse path segment like `task=56` (also accepts bare numeric ids). */
export function parseTaskKeyParam(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const keyed = raw.match(/^task=(\d+)$/i);
  if (keyed) {
    const id = Number(keyed[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  const bare = Number(raw);
  return Number.isFinite(bare) && bare > 0 ? bare : null;
}

/** Supports project/task path style, legacy Bitrix path, and ?task= query links. */
export function parseTaskIdFromLink(link: string | null | undefined): number | null {
  if (!link) return null;

  const projectTask = link.match(/\/tasks\/task=(\d+)/i);
  if (projectTask) {
    const id = Number(projectTask[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  const legacyBitrix = link.match(/\/tasks\/task\/view\/(\d+)/);
  if (legacyBitrix) {
    const id = Number(legacyBitrix[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  const queryMatch = link.match(/[?&]task=(\d+)/);
  if (queryMatch) {
    const id = Number(queryMatch[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  return null;
}
