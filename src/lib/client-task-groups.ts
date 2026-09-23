export const UNASSIGNED_CLIENT_LABEL = "No client / agency";
export const UNASSIGNED_PROJECT_LABEL = "No project";

export type ClientTaskGroupable = {
  id: number;
  createdBy?: number | null;
  projectId?: number | null;
  project?: {
    id: number;
    name: string;
    color?: string | null;
    clientName?: string | null;
  } | null;
  creator?: { name: string | null } | null;
};

export type ClientProjectTaskGroup<T extends ClientTaskGroupable> = {
  key: string;
  clientName: string;
  taskCount: number;
  projects: Array<{
    key: string;
    projectId: number | null;
    projectName: string;
    projectColor: string | null;
    tasks: T[];
  }>;
};

function readMappedName(
  map: Map<number, string> | Record<number, string> | undefined,
  id: number,
) {
  if (!map) return "";
  if (map instanceof Map) return map.get(id)?.trim() ?? "";
  return map[id]?.trim() ?? "";
}

function compareLabel(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function resolveClientAgencyName(
  task: ClientTaskGroupable,
  options?: {
    clientNameByUserId?: Map<number, string> | Record<number, string>;
    projectClientNameById?: Map<number, string> | Record<number, string>;
  },
) {
  const projectId = task.projectId ?? task.project?.id ?? null;
  const fromProject = task.project?.clientName?.trim();
  if (fromProject) return fromProject;

  if (projectId != null) {
    const fromProjectMap = readMappedName(options?.projectClientNameById, projectId);
    if (fromProjectMap) return fromProjectMap;
  }

  if (task.createdBy != null) {
    const fromCustomer = readMappedName(options?.clientNameByUserId, task.createdBy);
    if (fromCustomer) return fromCustomer;
  }

  const creatorName = task.creator?.name?.trim();
  if (creatorName) return creatorName;
  return UNASSIGNED_CLIENT_LABEL;
}

export function groupTasksByClientAndProject<T extends ClientTaskGroupable>(
  tasks: T[],
  options?: {
    clientNameByUserId?: Map<number, string> | Record<number, string>;
    projectClientNameById?: Map<number, string> | Record<number, string>;
  },
): ClientProjectTaskGroup<T>[] {
  const clients = new Map<
    string,
    {
      clientName: string;
      projects: Map<
        string,
        {
          projectId: number | null;
          projectName: string;
          projectColor: string | null;
          tasks: T[];
        }
      >;
    }
  >();

  for (const task of tasks) {
    const clientName = resolveClientAgencyName(task, options);
    const clientKey = clientName.trim().toLowerCase();
    const projectId = task.projectId ?? task.project?.id ?? null;
    const projectName = task.project?.name?.trim() || UNASSIGNED_PROJECT_LABEL;
    const projectColor = task.project?.color ?? null;
    const projectKey = projectId != null ? `project:${projectId}` : "project:none";

    let client = clients.get(clientKey);
    if (!client) {
      client = { clientName, projects: new Map() };
      clients.set(clientKey, client);
    }

    let project = client.projects.get(projectKey);
    if (!project) {
      project = { projectId, projectName, projectColor, tasks: [] };
      client.projects.set(projectKey, project);
    }
    project.tasks.push(task);
  }

  return [...clients.values()]
    .sort((a, b) => {
      if (a.clientName === UNASSIGNED_CLIENT_LABEL) return 1;
      if (b.clientName === UNASSIGNED_CLIENT_LABEL) return -1;
      return compareLabel(a.clientName, b.clientName);
    })
    .map((client) => {
      const projects = [...client.projects.entries()]
        .sort(([, a], [, b]) => {
          if (a.projectId == null) return 1;
          if (b.projectId == null) return -1;
          return compareLabel(a.projectName, b.projectName);
        })
        .map(([key, project]) => ({ key, ...project }));

      return {
        key: `client:${client.clientName}`,
        clientName: client.clientName,
        taskCount: projects.reduce((sum, project) => sum + project.tasks.length, 0),
        projects,
      };
    });
}
