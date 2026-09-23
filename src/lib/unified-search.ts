import { isTaskRelatedToUser, type TaskForSearchFilter } from "@/lib/task-search-filter";

export type SearchUser = { id: number; name: string | null; avatar?: string | null };
export type SearchProject = { id: number; name: string; clientName?: string | null };

export type UnifiedSearchContext = {
  users: SearchUser[];
  projects: SearchProject[];
};

export type SearchSuggestion =
  | { kind: "user"; id: number; label: string; avatar?: string | null }
  | { kind: "project"; id: number; label: string }
  | { kind: "task"; id: number; label: string };

export type TaskWithProject = TaskForSearchFilter & {
  projectId?: number | null;
};

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function textMatchesQuery(text: string, query: string) {
  const q = normalizeQuery(query);
  if (!q) return false;
  const lower = text.toLowerCase();
  if (lower.includes(q)) return true;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.some((word) => word.toLowerCase().startsWith(q))) return true;
  const initials = words.map((word) => word[0]?.toLowerCase() ?? "").join("");
  return initials.startsWith(q);
}

export function usersMatchingQuery(query: string, users: SearchUser[]) {
  const q = normalizeQuery(query);
  if (!q) return [];
  return users.filter((u) => u.name && textMatchesQuery(u.name, q));
}

export function projectsMatchingQuery(query: string, projects: SearchProject[]) {
  const q = normalizeQuery(query);
  if (!q) return [];
  return projects.filter(
    (p) =>
      textMatchesQuery(p.name, q) ||
      (p.clientName ? textMatchesQuery(p.clientName, q) : false),
  );
}

export function tasksMatchingTitleQuery(query: string, tasks: TaskWithProject[]) {
  const q = normalizeQuery(query);
  if (!q) return [];
  return tasks.filter(
    (t) =>
      textMatchesQuery(t.title, q) ||
      (t.description ? textMatchesQuery(t.description, q) : false),
  );
}

export function buildSearchSuggestions(
  query: string,
  ctx: UnifiedSearchContext,
  tasks: TaskWithProject[],
  limit = 10,
): SearchSuggestion[] {
  const q = normalizeQuery(query);
  const suggestions: SearchSuggestion[] = [];

  if (!q) {
    return [];
  }

  for (const user of usersMatchingQuery(q, ctx.users)) {
    if (!user.name) continue;
    suggestions.push({ kind: "user", id: user.id, label: user.name, avatar: user.avatar });
    if (suggestions.length >= limit) return suggestions;
  }

  for (const project of projectsMatchingQuery(q, ctx.projects)) {
    suggestions.push({ kind: "project", id: project.id, label: project.name });
    if (suggestions.length >= limit) return suggestions;
  }

  for (const task of tasksMatchingTitleQuery(q, tasks)) {
    suggestions.push({ kind: "task", id: task.id, label: task.title });
    if (suggestions.length >= limit) return suggestions;
  }

  return suggestions;
}

export function taskMatchesUnifiedSearch(
  task: TaskWithProject,
  query: string,
  ctx: UnifiedSearchContext,
): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;

  const titleMatch = textMatchesQuery(task.title, q);
  const descMatch = task.description ? textMatchesQuery(task.description, q) : false;
  const assigneeMatch = task.assignee?.name ? textMatchesQuery(task.assignee.name, q) : false;

  const matchedUsers = usersMatchingQuery(q, ctx.users);
  const userMatch = matchedUsers.some((u) => isTaskRelatedToUser(task, u.id));

  const matchedProjects = projectsMatchingQuery(q, ctx.projects);
  const projectMatch =
    task.projectId != null && matchedProjects.some((p) => p.id === task.projectId);

  return titleMatch || descMatch || assigneeMatch || userMatch || projectMatch;
}

export function projectsMatchingUnifiedSearch(
  project: SearchProject & { description?: string | null },
  query: string,
): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  return (
    textMatchesQuery(project.name, q) ||
    (project.description ? textMatchesQuery(project.description, q) : false) ||
    ("clientName" in project && project.clientName
      ? textMatchesQuery(project.clientName, q)
      : false)
  );
}
