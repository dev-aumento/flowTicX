export type ProjectSearchField = "name" | "client";

export type ProjectSortOption =
  | "name-asc"
  | "name-desc"
  | "client-asc"
  | "client-desc"
  | "date-desc"
  | "date-asc"
  | "id-asc"
  | "id-desc";

export const PROJECT_SEARCH_FIELD_OPTIONS: Array<{
  value: ProjectSearchField;
  label: string;
  placeholder: string;
}> = [
  { value: "name", label: "Project Name", placeholder: "Search by project name..." },
  { value: "client", label: "Client / Agency", placeholder: "Search by client or agency..." },
];

export const PROJECT_SORT_OPTIONS: Array<{ value: ProjectSortOption; label: string }> = [
  { value: "name-asc", label: "Name (A → Z)" },
  { value: "name-desc", label: "Name (Z → A)" },
  { value: "client-asc", label: "Client / Agency (A → Z)" },
  { value: "client-desc", label: "Client / Agency (Z → A)" },
  { value: "date-desc", label: "Date (Newest first)" },
  { value: "date-asc", label: "Date (Oldest first)" },
  { value: "id-asc", label: "ID (Low → High)" },
  { value: "id-desc", label: "ID (High → Low)" },
];

export const DEFAULT_PROJECT_SORT: ProjectSortOption = "name-asc";
export const DEFAULT_PROJECT_SEARCH_FIELD: ProjectSearchField = "name";

type ProjectSearchRow = {
  name: string;
  description?: string | null;
  clientName?: string | null;
};

type ProjectSortRow = ProjectSearchRow & {
  id?: number | null;
  lastActiveAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
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

function projectSortTimestamp(project: ProjectSortRow) {
  const raw = project.lastActiveAt ?? project.updatedAt ?? project.createdAt;
  if (!raw) return 0;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function projectMatchesSearch(
  project: ProjectSearchRow,
  query: string,
  field: ProjectSearchField,
) {
  const q = normalizeQuery(query);
  if (!q) return true;

  if (field === "client") {
    return project.clientName ? textMatchesQuery(project.clientName, q) : false;
  }

  return (
    textMatchesQuery(project.name, q) ||
    (project.description ? textMatchesQuery(project.description, q) : false)
  );
}

export function filterProjectsByAgency<T extends { clientName?: string | null }>(
  projects: T[],
  agencyFilter: string,
) {
  const selected = agencyFilter.trim();
  if (!selected) return projects;
  return projects.filter((project) => (project.clientName ?? "").trim() === selected);
}

export function sortProjects<T extends ProjectSortRow>(
  projects: T[],
  sort: ProjectSortOption,
): T[] {
  const sorted = [...projects];

  sorted.sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return compareText(a.name, b.name);
      case "name-desc":
        return compareText(b.name, a.name);
      case "client-asc": {
        const aClient = (a.clientName ?? "").trim() || a.name;
        const bClient = (b.clientName ?? "").trim() || b.name;
        return compareText(aClient, bClient) || compareText(a.name, b.name);
      }
      case "client-desc": {
        const aClient = (a.clientName ?? "").trim() || a.name;
        const bClient = (b.clientName ?? "").trim() || b.name;
        return compareText(bClient, aClient) || compareText(b.name, a.name);
      }
      case "date-desc":
        return projectSortTimestamp(b) - projectSortTimestamp(a) || compareText(a.name, b.name);
      case "date-asc":
        return projectSortTimestamp(a) - projectSortTimestamp(b) || compareText(a.name, b.name);
      case "id-asc":
        return (a.id ?? 0) - (b.id ?? 0) || compareText(a.name, b.name);
      case "id-desc":
        return (b.id ?? 0) - (a.id ?? 0) || compareText(a.name, b.name);
      default:
        return 0;
    }
  });

  return sorted;
}

export function applyProjectListFilters<T extends ProjectSortRow>(
  projects: T[],
  options: {
    search: string;
    searchField: ProjectSearchField;
    sort: ProjectSortOption;
    agencyFilter?: string;
  },
) {
  const searched = projects.filter((project) =>
    projectMatchesSearch(project, options.search, options.searchField),
  );
  const byAgency = filterProjectsByAgency(searched, options.agencyFilter ?? "");
  return sortProjects(byAgency, options.sort);
}

const PROJECTS_LIST_STATE_KEY = "projects.listState.v1";

export type ProjectsListPersistedState = {
  search: string;
  searchField: ProjectSearchField;
  sortBy: ProjectSortOption;
  agencyFilter: string;
  page: number;
};

const DEFAULT_PROJECTS_LIST_STATE: ProjectsListPersistedState = {
  search: "",
  searchField: DEFAULT_PROJECT_SEARCH_FIELD,
  sortBy: DEFAULT_PROJECT_SORT,
  agencyFilter: "",
  page: 1,
};

function isProjectSearchField(value: unknown): value is ProjectSearchField {
  return value === "name" || value === "client";
}

function isProjectSortOption(value: unknown): value is ProjectSortOption {
  return typeof value === "string" && PROJECT_SORT_OPTIONS.some((option) => option.value === value);
}

/** Restore Projects list filters after navigating into a project and back. */
export function loadProjectsListState(): ProjectsListPersistedState {
  try {
    const raw = sessionStorage.getItem(PROJECTS_LIST_STATE_KEY);
    if (!raw) return { ...DEFAULT_PROJECTS_LIST_STATE };
    const parsed = JSON.parse(raw) as Partial<ProjectsListPersistedState>;
    return {
      search: typeof parsed.search === "string" ? parsed.search : DEFAULT_PROJECTS_LIST_STATE.search,
      searchField: isProjectSearchField(parsed.searchField)
        ? parsed.searchField
        : DEFAULT_PROJECTS_LIST_STATE.searchField,
      sortBy: isProjectSortOption(parsed.sortBy) ? parsed.sortBy : DEFAULT_PROJECTS_LIST_STATE.sortBy,
      agencyFilter:
        typeof parsed.agencyFilter === "string"
          ? parsed.agencyFilter
          : DEFAULT_PROJECTS_LIST_STATE.agencyFilter,
      page:
        typeof parsed.page === "number" && Number.isFinite(parsed.page) && parsed.page >= 1
          ? Math.floor(parsed.page)
          : DEFAULT_PROJECTS_LIST_STATE.page,
    };
  } catch {
    return { ...DEFAULT_PROJECTS_LIST_STATE };
  }
}

export function saveProjectsListState(state: ProjectsListPersistedState) {
  try {
    sessionStorage.setItem(PROJECTS_LIST_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota / private-mode failures.
  }
}
