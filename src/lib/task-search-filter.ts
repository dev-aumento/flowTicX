import type { TaskRoleFilter } from "@/lib/task-role-filter";
import { isTaskAlmostOverdue, isTaskOverdue } from "@/lib/task-deadline";
import { readTaskPref } from "@/lib/task-prefs";
import {
  DEFAULT_TASK_STATUS_LABELS,
  type TaskStatusLabels,
} from "@/lib/task-status-labels";
import {
  taskMatchesUnifiedSearch,
  type UnifiedSearchContext,
} from "@/lib/unified-search";

export type TaskStatusSidebarFilter =
  | "in_progress"
  | "completed"
  | "deferred"
  | "overdue"
  | "almost_overdue";

export function taskStatusSidebarOptions(
  labels: TaskStatusLabels = DEFAULT_TASK_STATUS_LABELS,
): { id: TaskStatusSidebarFilter; label: string }[] {
  return [
    { id: "in_progress", label: labels.in_progress },
    { id: "completed", label: labels.done },
    { id: "deferred", label: labels.deferred },
    { id: "overdue", label: "Overdue" },
    { id: "almost_overdue", label: "Almost overdue" },
  ];
}

export const TASK_STATUS_SIDEBAR_OPTIONS = taskStatusSidebarOptions();

export type TaskPersonRoleFilter =
  | "all"
  | "owner"
  | "assignee"
  | "participant"
  | "observer";

export const TASK_PERSON_ROLE_OPTIONS: { id: TaskPersonRoleFilter; label: string }[] = [
  { id: "all", label: "Not specified" },
  { id: "owner", label: "Owner" },
  { id: "assignee", label: "Assignee" },
  { id: "participant", label: "Participants" },
  { id: "observer", label: "Observer" },
];

export type TaskSearchFilters = {
  statusSidebar: TaskStatusSidebarFilter | null;
  personRole: TaskPersonRoleFilter;
  personUserId: number | null;
  projectId: number | null;
  text: string;
};

export const DEFAULT_TASK_SEARCH_FILTERS: TaskSearchFilters = {
  statusSidebar: null,
  personRole: "all",
  personUserId: null,
  projectId: null,
  text: "",
};

export type TaskForSearchFilter = {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  assigneeId?: number | null;
  createdBy?: number | null;
  projectId?: number | null;
  participantIds?: number[];
  observerIds?: number[];
  assignee?: { name: string | null } | null;
};

export function isTaskRelatedToUser(task: TaskForSearchFilter, userId: number) {
  return (
    task.assigneeId === userId ||
    task.createdBy === userId ||
    (task.participantIds?.includes(userId) ?? false) ||
    (task.observerIds?.includes(userId) ?? false)
  );
}

export function taskMatchesPersonRoleFilter(
  task: TaskForSearchFilter,
  userId: number,
  role: TaskPersonRoleFilter,
) {
  switch (role) {
    case "owner":
      return task.createdBy === userId;
    case "assignee":
      return task.assigneeId === userId;
    case "participant":
      return task.participantIds?.includes(userId) ?? false;
    case "observer":
      return task.observerIds?.includes(userId) ?? false;
    case "all":
    default:
      return isTaskRelatedToUser(task, userId);
  }
}

export function taskMatchesStatusSidebarFilter(
  task: TaskForSearchFilter,
  filter: TaskStatusSidebarFilter,
): boolean {
  switch (filter) {
    case "in_progress":
      return task.status === "in_progress" && !readTaskPref(task.id, "deferred", false);
    case "completed":
      return task.status === "done";
    case "deferred":
      return readTaskPref(task.id, "deferred", false);
    case "overdue":
      return isTaskOverdue(task);
    case "almost_overdue":
      return isTaskAlmostOverdue(task);
    default:
      return true;
  }
}

export function applyTaskSearchFilters<T extends TaskForSearchFilter>(
  tasks: T[],
  filters: TaskSearchFilters,
  searchContext?: UnifiedSearchContext,
): T[] {
  let result = tasks;

  if (filters.statusSidebar) {
    result = result.filter((t) => taskMatchesStatusSidebarFilter(t, filters.statusSidebar!));
  }

  if (filters.personUserId != null) {
    result = result.filter((t) =>
      taskMatchesPersonRoleFilter(t, filters.personUserId!, filters.personRole),
    );
  }

  if (filters.projectId != null) {
    result = result.filter((t) => t.projectId === filters.projectId);
  }

  const q = filters.text.trim();
  if (q) {
    if (searchContext) {
      result = result.filter((t) => taskMatchesUnifiedSearch(t, q, searchContext));
    } else {
      const lower = q.toLowerCase();
      result = result.filter((t) => {
        const titleMatch = t.title.toLowerCase().includes(lower);
        const descMatch = t.description?.toLowerCase().includes(lower) ?? false;
        const assigneeMatch = t.assignee?.name?.toLowerCase().includes(lower) ?? false;
        return titleMatch || descMatch || assigneeMatch;
      });
    }
  }

  return result;
}

export function formatActiveTaskFiltersSummary(
  filters: Omit<TaskSearchFilters, "text">,
  options?: {
    showOverdueOnly?: boolean;
    personName?: string | null;
    projectName?: string | null;
    statusLabels?: TaskStatusLabels;
  },
): string {
  const parts: string[] = [];
  const statusOptions = taskStatusSidebarOptions(
    options?.statusLabels ?? DEFAULT_TASK_STATUS_LABELS,
  );

  if (options?.showOverdueOnly) parts.push("Overdue");
  if (filters.statusSidebar) {
    const label = statusOptions.find((o) => o.id === filters.statusSidebar)?.label;
    if (label) parts.push(label);
  }

  if (filters.personRole !== "all") {
    const roleLabel = TASK_PERSON_ROLE_OPTIONS.find((o) => o.id === filters.personRole)?.label;
    if (roleLabel) parts.push(roleLabel);
  }

  if (filters.personUserId != null) {
    parts.push(options?.personName?.trim() || "Person");
  }

  if (filters.projectId != null) {
    parts.push(options?.projectName?.trim() || "Project");
  }

  return parts.join(" · ");
}

/** @deprecated Use person-based filters in search panel */
export type TaskSearchFiltersLegacy = TaskSearchFilters & { role?: TaskRoleFilter };
