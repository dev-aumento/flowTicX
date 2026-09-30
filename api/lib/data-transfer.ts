import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type {
  DataTransferDataset,
  DataTransferFormat,
  DataTransferLogDoc,
  CustomerDoc,
  ProjectDoc,
  ProjectStatus,
  TaskDoc,
  TaskPriority,
  TaskStatus,
  TimeEntryDoc,
  UserDoc,
} from "@db/mongo/types";
import { getCollection, insertDoc, updateById } from "../queries/connection";
import { requireOrganizationId } from "./tenant";
import { hasPermission } from "./permissions";
import { assertPlanFeature } from "./plan-guard";
import { assertCanAddProject, notifyIfProjectLimitReached } from "./plan-capacity";
import { joinProject } from "../queries/project-members";
import { parseCsv, parseDocx, parseHtmlTable, parsePdf, toCsv, toDocx, toPdf, type TabularFile } from "./data-files";

const DATASET_FEATURE: Record<DataTransferDataset, string> = {
  projects: "projects",
  tasks: "tasks",
  hours: "time_tracking",
  clients: "time_tracking",
};

const PROJECT_HEADERS = ["Name", "Description", "Client", "Status"];
const TASK_HEADERS = ["Title", "Description", "Project", "Status", "Priority", "Assignee email", "Due date", "Estimated hours"];
const HOUR_TOTAL_HEADERS = ["Project", "Task", "Total hours"];
const HOUR_SUMMARY_HEADERS = ["Project", "Task", "Time entries", "Total hours"];
const CLIENT_PROJECT_HEADERS = ["Project name", "Total hours of all tasks"];
const CLIENT_TASK_HEADERS = ["Project name", "Task", "Hours"];

export type ExportScope = {
  mode: "all" | "project" | "task" | "totals" | "client-projects" | "client-tasks";
  projectId: number | null;
  taskId: number | null;
  clientName: string | null;
};

const PROJECT_STATUSES = new Set<ProjectStatus>(["active", "archived", "completed"]);
const TASK_STATUSES = new Set<TaskStatus>(["todo", "in_progress", "review", "done"]);
const TASK_PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "urgent"]);

type Actor = {
  id: number;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  permissions?: string[] | null;
  department?: string | null;
  organizationId?: number | null;
};

export function assertCanManageData(user: Actor) {
  const role = String(user.role ?? "").toLowerCase();
  const department = String(user.department ?? "").trim().toLowerCase();
  if (
    role === "client" ||
    role === "finance" ||
    role === "platform" ||
    department === "hr" ||
    department === "human resources"
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage workspace data." });
  }
  if (role === "admin" || role === "manager") return;
  if (hasPermission(user as Parameters<typeof hasPermission>[0], "projects.manage")) return;
  if (hasPermission(user as Parameters<typeof hasPermission>[0], "permissions.manage")) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage workspace data." });
}

export async function listDataTransferLogs(organizationId: number) {
  const col = await getCollection<DataTransferLogDoc>(Collections.dataTransferLogs);
  return col.find({ organizationId }).sort({ createdAt: -1, id: -1 }).limit(100).toArray();
}

type PendingExport = {
  userId: number;
  organizationId: number;
  dataset: DataTransferDataset;
  format: DataTransferFormat;
  fileName: string;
  rowCount: number;
  message: string;
  expiresAt: number;
};

const pendingExports = new Map<string, PendingExport>();

export async function listExportChoices(user: Actor) {
  assertCanManageData(user);
  const organizationId = organizationIdOf(user);
  const projects = await getCollection<ProjectDoc>(Collections.projects);
  const tasks = await getCollection<TaskDoc>(Collections.tasks);
  const projectDocs = await projects
    .find({ organizationId })
    .project({ id: 1, name: 1, clientName: 1, createdBy: 1 })
    .sort({ name: 1 })
    .toArray();
  const taskDocs = await tasks
    .find({ organizationId })
    .project({ id: 1, title: 1, projectId: 1 })
    .sort({ title: 1 })
    .limit(3000)
    .toArray();
  return {
    projects: projectDocs.map((project) => ({ id: project.id, name: project.name })),
    tasks: taskDocs.map((task) => ({
      id: task.id,
      title: task.title,
      projectId: task.projectId ?? null,
    })),
    clients: await listClientNames(
      organizationId,
      projectDocs.map((project) => ({
        clientName: typeof project.clientName === "string" ? project.clientName : null,
        createdBy: typeof project.createdBy === "number" ? project.createdBy : null,
      })),
    ),
  };
}

export async function exportDataset(
  user: Actor,
  dataset: DataTransferDataset,
  format: DataTransferFormat,
  scope: ExportScope = { mode: "all", projectId: null, taskId: null, clientName: null },
) {
  assertCanManageData(user);
  const organizationId = organizationIdOf(user);
  await assertPlanFeature(user, DATASET_FEATURE[dataset]);
  const resolved = await resolveScope(organizationId, dataset, scope);
  const table = await buildTable(organizationId, dataset, resolved);
  const file = await renderFile(table, dataset, format, resolved.fileKey, exportTitle(dataset, resolved));
  const message = exportMessage(dataset, format, table.rows.length, resolved);
  const token = rememberExport({
    userId: user.id,
    organizationId,
    dataset,
    format,
    fileName: file.fileName,
    rowCount: table.rows.length,
    message,
  });
  return { ...file, rowCount: table.rows.length, token };
}

export async function confirmExport(user: Actor, token: string, savedFileName?: string) {
  assertCanManageData(user);
  const organizationId = organizationIdOf(user);
  const pending = takePendingExport(token, user.id, organizationId);
  const fileName = (savedFileName?.trim() || pending.fileName).slice(0, 240);
  await writeLog(user, organizationId, {
    action: "export",
    dataset: pending.dataset,
    format: pending.format,
    fileName,
    rowCount: pending.rowCount,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    message: pending.message,
  });
  return { fileName, rowCount: pending.rowCount };
}

export async function importDataset(
  user: Actor,
  dataset: DataTransferDataset,
  format: DataTransferFormat,
  fileName: string,
  base64: string,
) {
  assertCanManageData(user);
  const organizationId = organizationIdOf(user);
  if (dataset === "clients") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Client hours can only be exported." });
  }
  await assertPlanFeature(user, DATASET_FEATURE[dataset]);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The file is empty." });
  }
  if (buffer.length > 8_000_000) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The file is larger than 8 MB." });
  }

  let table: TabularFile;
  try {
    table = await readTable(buffer, format, fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read this file.";
    await writeLog(user, organizationId, {
      action: "import",
      dataset,
      format,
      fileName,
      rowCount: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      message,
    });
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }

  if (table.headers.length === 0 || table.rows.length === 0) {
    const message = "No data rows were found. Use the column names from an export of this dataset.";
    await writeLog(user, organizationId, {
      action: "import",
      dataset,
      format,
      fileName,
      rowCount: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      message,
    });
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }

  const result =
    dataset === "projects"
      ? await importProjects(user, organizationId, table)
      : dataset === "tasks"
        ? await importTasks(user, organizationId, table)
        : await importHours(user, organizationId, table);

  const message = [
    `Imported ${datasetLabel(dataset)} from ${fileName}.`,
    `Created ${result.createdCount}, updated ${result.updatedCount}, skipped ${result.skippedCount}.`,
    result.notes.length ? result.notes.slice(0, 5).join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ");

  await writeLog(user, organizationId, {
    action: "import",
    dataset,
    format,
    fileName,
    rowCount: table.rows.length,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    skippedCount: result.skippedCount,
    message,
  });

  return {
    rowCount: table.rows.length,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    skippedCount: result.skippedCount,
    message,
  };
}

type ResolvedScope = ExportScope & {
  projectName: string | null;
  taskTitle: string | null;
  fileKey: string;
};

async function resolveScope(
  organizationId: number,
  dataset: DataTransferDataset,
  scope: ExportScope,
): Promise<ResolvedScope> {
  if (dataset === "clients") {
    if (scope.mode !== "client-projects" && scope.mode !== "client-tasks") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose project wise totals or task wise hours." });
    }
    const clientName = scope.clientName?.trim() ?? "";
    if (!clientName) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a client." });
    }
    const slug = clientFileSlug(clientName);
    return {
      mode: scope.mode,
      projectId: null,
      taskId: null,
      clientName,
      projectName: null,
      taskTitle: null,
      fileKey: scope.mode === "client-projects" ? `client-${slug}-project-totals` : `client-${slug}-task-hours`,
    };
  }

  if (dataset === "projects" || scope.mode === "all") {
    return {
      mode: "all",
      projectId: null,
      taskId: null,
      clientName: null,
      projectName: null,
      taskTitle: null,
      fileKey: dataset,
    };
  }

  if (scope.mode === "client-projects" || scope.mode === "client-tasks") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a client export." });
  }

  if (dataset === "tasks" && scope.mode !== "project") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose overall tasks or one project." });
  }
  if (dataset === "hours" && scope.mode === "task" && scope.taskId == null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a task." });
  }
  if (scope.mode === "project" && scope.projectId == null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a project." });
  }

  const project = scope.projectId != null ? await findOrgProject(organizationId, scope.projectId) : null;
  if (scope.mode === "project" && !project) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a project in this workspace." });
  }

  const task = scope.taskId != null ? await findOrgTask(organizationId, scope.taskId) : null;
  if (scope.mode === "task") {
    if (!task) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a task in this workspace." });
    if (project && task.projectId !== project.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That task is not in the selected project." });
    }
  }

  const fileKey =
    scope.mode === "totals" ? "hours-totals" : scope.mode === "task" ? "hours-task" : `${dataset}-project`;
  return {
    mode: scope.mode,
    projectId: project?.id ?? null,
    taskId: task?.id ?? null,
    clientName: null,
    projectName: project?.name ?? null,
    taskTitle: task?.title ?? null,
    fileKey,
  };
}

async function buildTable(
  organizationId: number,
  dataset: DataTransferDataset,
  scope: ResolvedScope,
): Promise<TabularFile> {
  if (dataset === "projects") {
    const projects = await getCollection<ProjectDoc>(Collections.projects);
    const docs = await projects.find({ organizationId }).sort({ name: 1 }).toArray();
    return {
      headers: PROJECT_HEADERS,
      rows: docs.map((project) => [
        project.name,
        project.description ?? "",
        project.clientName ?? "",
        project.status,
      ]),
    };
  }

  if (dataset === "tasks") {
    const tasks = await getCollection<TaskDoc>(Collections.tasks);
    const filter = scope.projectId != null ? { organizationId, projectId: scope.projectId } : { organizationId };
    const docs = await tasks.find(filter).sort({ createdAt: -1 }).toArray();
    const projectMap = await projectNameMap(organizationId);
    const userMap = await userEmailMap(organizationId);
    return {
      headers: TASK_HEADERS,
      rows: docs.map((task) => [
        task.title,
        task.description ?? "",
        task.projectId != null ? projectMap.get(task.projectId) ?? "" : "",
        task.status,
        task.priority,
        task.assigneeId != null ? userMap.get(task.assigneeId) ?? "" : "",
        task.dueDate ? toIso(task.dueDate) : "",
        task.estimatedHours ?? "",
      ]),
    };
  }

  if (dataset === "clients") return buildClientHours(organizationId, scope);

  return buildHourTotals(organizationId, scope.projectId, scope.taskId, scope.mode === "totals");
}

async function buildHourTotals(
  organizationId: number,
  projectId: number | null,
  taskId: number | null,
  withSummary: boolean,
): Promise<TabularFile> {
  const tasks = await getCollection<TaskDoc>(Collections.tasks);
  const taskFilter =
    taskId != null
      ? { organizationId, id: taskId }
      : projectId != null
        ? { organizationId, projectId }
        : { organizationId };
  const taskDocs = await tasks.find(taskFilter).sort({ title: 1 }).toArray();
  const projectMap = await projectNameMap(organizationId);
  const entries = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const taskIds = taskDocs.map((task) => task.id);
  const entryDocs =
    taskIds.length > 0
      ? await entries.find({ organizationId, taskId: { $in: taskIds } }).toArray()
      : [];
  const totals = new Map<number, { seconds: number; count: number }>();
  for (const entry of entryDocs) {
    if (entry.taskId == null) continue;
    const current = totals.get(entry.taskId) ?? { seconds: 0, count: 0 };
    current.seconds += entrySeconds(entry);
    current.count += 1;
    totals.set(entry.taskId, current);
  }

  const sorted = [...taskDocs].sort((left, right) => {
    const leftName = left.projectId != null ? projectMap.get(left.projectId) ?? "" : "";
    const rightName = right.projectId != null ? projectMap.get(right.projectId) ?? "" : "";
    return leftName.localeCompare(rightName) || left.title.localeCompare(right.title);
  });

  const rows: string[][] = [];
  let currentProject: string | null = null;
  let projectSeconds = 0;
  let projectEntries = 0;
  const flush = () => {
    if (!withSummary || currentProject == null) return;
    rows.push([currentProject, "Total", String(projectEntries), hoursLabel(projectSeconds)]);
  };

  for (const task of sorted) {
    const projectName = task.projectId != null ? projectMap.get(task.projectId) ?? "" : "";
    if (currentProject !== projectName) {
      flush();
      currentProject = projectName;
      projectSeconds = 0;
      projectEntries = 0;
    }
    const stat = totals.get(task.id) ?? { seconds: 0, count: 0 };
    rows.push(
      withSummary
        ? [projectName, task.title, String(stat.count), hoursLabel(stat.seconds)]
        : [projectName, task.title, hoursLabel(stat.seconds)],
    );
    projectSeconds += stat.seconds;
    projectEntries += stat.count;
  }
  flush();
  return { headers: withSummary ? HOUR_SUMMARY_HEADERS : HOUR_TOTAL_HEADERS, rows };
}

async function findOrgProject(organizationId: number, projectId: number) {
  const projects = await getCollection<ProjectDoc>(Collections.projects);
  return projects.findOne({ organizationId, id: projectId });
}

async function findOrgTask(organizationId: number, taskId: number) {
  const tasks = await getCollection<TaskDoc>(Collections.tasks);
  return tasks.findOne({ organizationId, id: taskId });
}

function entrySeconds(entry: TimeEntryDoc) {
  if (typeof entry.durationSeconds === "number" && entry.durationSeconds >= 0) return entry.durationSeconds;
  if (entry.clockOut) {
    return Math.max(0, Math.floor((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 1000));
  }
  return 0;
}

function hoursLabel(seconds: number) {
  return (seconds / 3600).toFixed(2);
}

function hoursAmount(seconds: number) {
  const rounded = Math.round((seconds / 3600) * 100) / 100;
  return String(rounded);
}

function normalizeClientKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function clientFileSlug(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "client";
}

function exportTitle(dataset: DataTransferDataset, scope: ResolvedScope) {
  if (dataset === "clients" && scope.clientName) {
    return scope.mode === "client-projects"
      ? `${scope.clientName} project totals`
      : `${scope.clientName} task hours`;
  }
  return `${datasetLabel(dataset)} export`;
}

async function listClientNames(
  organizationId: number,
  projectDocs: Array<{ clientName: string | null; createdBy: number | null }>,
) {
  const names = new Map<string, string>();
  const add = (raw: string | null | undefined) => {
    const name = raw?.trim().replace(/\s+/g, " ") ?? "";
    if (!name) return;
    const key = name.toLowerCase();
    if (!names.has(key)) names.set(key, name);
  };

  for (const project of projectDocs) add(project.clientName);

  const blankProjectCreators = new Set(
    projectDocs
      .filter((project) => !project.clientName?.trim() && project.createdBy != null)
      .map((project) => project.createdBy as number),
  );
  if (blankProjectCreators.size > 0) {
    const users = await getCollection<UserDoc>(Collections.users);
    const clientUsers = await users
      .find({ organizationId, role: "client", id: { $in: [...blankProjectCreators] } })
      .project({ id: 1, name: 1 })
      .toArray();
    for (const user of clientUsers) add(user.name);

    const customers = await getCollection<CustomerDoc>(Collections.customers);
    const customerDocs = await customers
      .find({ organizationId, sourceUserId: { $in: [...blankProjectCreators] } })
      .project({ displayName: 1, companyName: 1 })
      .toArray();
    for (const customer of customerDocs) add(customer.displayName || customer.companyName);
  }

  return [...names.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

async function projectsForClient(organizationId: number, clientName: string) {
  const key = normalizeClientKey(clientName);
  const projects = await getCollection<ProjectDoc>(Collections.projects);
  const projectDocs = await projects.find({ organizationId }).toArray();
  const users = await getCollection<UserDoc>(Collections.users);
  const clientUsers = await users
    .find({ organizationId, role: "client" })
    .project({ id: 1, name: 1 })
    .toArray();
  const customers = await getCollection<CustomerDoc>(Collections.customers);
  const customerDocs = await customers
    .find({ organizationId })
    .project({ displayName: 1, companyName: 1, sourceUserId: 1 })
    .toArray();

  const matchingUserIds = new Set<number>();
  for (const user of clientUsers) {
    if (normalizeClientKey(user.name ?? "") === key) matchingUserIds.add(user.id);
  }
  for (const customer of customerDocs) {
    const label = (customer.displayName || customer.companyName || "").trim();
    if (customer.sourceUserId != null && normalizeClientKey(label) === key) {
      matchingUserIds.add(customer.sourceUserId);
    }
  }

  let memberProjectIds = new Set<number>();
  if (matchingUserIds.size > 0) {
    const members = await getCollection<{ projectId: number; userId: number }>(Collections.projectMembers);
    const rows = await members
      .find({ userId: { $in: [...matchingUserIds] } })
      .project({ projectId: 1 })
      .toArray();
    memberProjectIds = new Set(rows.map((row) => row.projectId));
  }

  return projectDocs.filter((project) => {
    const named = normalizeClientKey(project.clientName ?? "");
    if (named) return named === key;
    if (project.createdBy != null && matchingUserIds.has(project.createdBy)) return true;
    return memberProjectIds.has(project.id);
  });
}

async function buildClientHours(organizationId: number, scope: ResolvedScope): Promise<TabularFile> {
  const clientName = scope.clientName?.trim() ?? "";
  const matched = await projectsForClient(organizationId, clientName);
  if (matched.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No projects were found for this client." });
  }
  matched.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id - right.id);

  const projectIds = matched.map((project) => project.id);
  const tasks = await getCollection<TaskDoc>(Collections.tasks);
  const taskDocs = await tasks.find({ organizationId, projectId: { $in: projectIds } }).toArray();
  const entries = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const taskIds = taskDocs.map((task) => task.id);
  const entryDocs =
    taskIds.length > 0 ? await entries.find({ organizationId, taskId: { $in: taskIds } }).toArray() : [];
  const secondsByTask = new Map<number, number>();
  for (const entry of entryDocs) {
    if (entry.taskId == null) continue;
    secondsByTask.set(entry.taskId, (secondsByTask.get(entry.taskId) ?? 0) + entrySeconds(entry));
  }
  const tasksByProject = new Map<number, TaskDoc[]>();
  for (const task of taskDocs) {
    if (task.projectId == null) continue;
    const list = tasksByProject.get(task.projectId) ?? [];
    list.push(task);
    tasksByProject.set(task.projectId, list);
  }

  if (scope.mode === "client-projects") {
    return {
      headers: CLIENT_PROJECT_HEADERS,
      rows: matched.map((project) => {
        const seconds = (tasksByProject.get(project.id) ?? []).reduce(
          (sum, task) => sum + (secondsByTask.get(task.id) ?? 0),
          0,
        );
        return [project.name, hoursAmount(seconds)];
      }),
    };
  }

  const rows: string[][] = [];
  for (const project of matched) {
    const projectTasks = [...(tasksByProject.get(project.id) ?? [])].sort((left, right) =>
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" }),
    );
    let seconds = 0;
    for (const task of projectTasks) {
      const taskSeconds = secondsByTask.get(task.id) ?? 0;
      seconds += taskSeconds;
      rows.push([project.name, task.title, `${hoursAmount(taskSeconds)} hours`]);
    }
    rows.push([project.name, "Total", `${hoursAmount(seconds)} hours`]);
  }
  return { headers: CLIENT_TASK_HEADERS, rows };
}

function exportMessage(
  dataset: DataTransferDataset,
  format: DataTransferFormat,
  rowCount: number,
  scope: ResolvedScope,
) {
  if (dataset === "clients" && scope.clientName) {
    const what = scope.mode === "client-projects" ? "project totals" : "task hour rows";
    return `Exported ${rowCount} ${what} for ${scope.clientName} as ${formatLabel(format)}.`;
  }
  const what = dataset === "hours" && scope.mode === "totals" ? "task hour totals" : datasetLabel(dataset);
  const where = scope.taskTitle
    ? ` for ${scope.taskTitle}`
    : scope.projectName
      ? ` from ${scope.projectName}`
      : "";
  return `Exported ${rowCount} ${what}${where} as ${formatLabel(format)}.`;
}

async function importProjects(user: Actor, organizationId: number, table: TabularFile) {
  const index = headerIndex(table.headers);
  const projects = await getCollection<ProjectDoc>(Collections.projects);
  const existing = (await projects.find({ organizationId }).toArray()) as ProjectDoc[];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const notes: string[] = [];
  const now = new Date();

  for (const row of table.rows) {
    const name = cell(row, index, ["name", "project", "projectname", "title"]);
    if (!name) {
      skippedCount += 1;
      continue;
    }
    const description = cell(row, index, ["description", "details"]) || null;
    const clientName = cell(row, index, ["client", "clientname", "customer"]) || null;
    const status = normalizeProjectStatus(cell(row, index, ["status"]));
    const match = existing.find((project) => project.name.trim().toLowerCase() === name.toLowerCase());
    if (match) {
      await updateById<ProjectDoc>(Collections.projects, match.id, {
        description,
        clientName,
        status,
        updatedAt: now,
      });
      match.description = description;
      match.clientName = clientName;
      match.status = status;
      updatedCount += 1;
      continue;
    }
    try {
      await assertCanAddProject(organizationId, user.id);
    } catch (error) {
      skippedCount += 1;
      notes.push(error instanceof Error ? error.message : "Project limit reached.");
      continue;
    }
    const created = await insertDoc<ProjectDoc>(Collections.projects, {
      organizationId,
      name,
      description,
      clientName,
      status,
      color: null,
      icon: null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    });
    await joinProject(created.id, user.id);
    existing.push(created);
    createdCount += 1;
    await notifyIfProjectLimitReached(organizationId, user.id);
  }
  return { createdCount, updatedCount, skippedCount, notes: uniqueNotes(notes) };
}

async function importTasks(user: Actor, organizationId: number, table: TabularFile) {
  const index = headerIndex(table.headers);
  const tasks = await getCollection<TaskDoc>(Collections.tasks);
  const existing = (await tasks.find({ organizationId }).toArray()) as TaskDoc[];
  const projects = await getCollection<ProjectDoc>(Collections.projects);
  const projectDocs = await projects.find({ organizationId }).toArray();
  const users = await getCollection<UserDoc>(Collections.users);
  const people = await users.find({ organizationId }).toArray();
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const notes: string[] = [];
  const now = new Date();

  for (const row of table.rows) {
    const title = cell(row, index, ["title", "task", "tasktitle", "name"]);
    if (!title) {
      skippedCount += 1;
      continue;
    }
    const projectName = cell(row, index, ["project", "projectname"]);
    const project = projectName
      ? projectDocs.find((item) => item.name.trim().toLowerCase() === projectName.toLowerCase())
      : undefined;
    if (projectName && !project) {
      skippedCount += 1;
      notes.push(`Project "${projectName}" was not found.`);
      continue;
    }
    const assigneeEmail = cell(row, index, ["assigneeemail", "assignee", "email", "employeeemail"]).toLowerCase();
    const assignee = assigneeEmail
      ? people.find((person) => (person.email ?? "").toLowerCase() === assigneeEmail)
      : undefined;
    if (assigneeEmail && !assignee) {
      notes.push(`No teammate uses ${assigneeEmail}.`);
    }
    const description = cell(row, index, ["description", "details"]) || null;
    const status = normalizeTaskStatus(cell(row, index, ["status"]));
    const priority = normalizePriority(cell(row, index, ["priority"]));
    const dueDate = parseDate(cell(row, index, ["duedate", "due"]));
    const estimatedHours = cell(row, index, ["estimatedhours", "estimate"]) || null;
    const projectId = project?.id ?? null;
    const match = existing.find(
      (task) =>
        task.title.trim().toLowerCase() === title.toLowerCase() && (task.projectId ?? null) === projectId,
    );
    if (match) {
      await updateById<TaskDoc>(Collections.tasks, match.id, {
        description,
        status,
        priority,
        assigneeId: assignee?.id ?? match.assigneeId,
        dueDate,
        estimatedHours,
        updatedAt: now,
      });
      updatedCount += 1;
      continue;
    }
    const created = await insertDoc<TaskDoc>(Collections.tasks, {
      organizationId,
      title,
      description,
      status,
      stage: "new",
      priority,
      assigneeId: assignee?.id ?? null,
      projectId,
      createdBy: user.id,
      dueDate,
      estimatedHours,
      actualHours: null,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    existing.push(created);
    createdCount += 1;
  }
  return { createdCount, updatedCount, skippedCount, notes: uniqueNotes(notes) };
}

async function importHours(user: Actor, organizationId: number, table: TabularFile) {
  const index = headerIndex(table.headers);
  const tasks = await getCollection<TaskDoc>(Collections.tasks);
  const taskDocs = await tasks.find({ organizationId }).toArray();
  const projects = await getCollection<ProjectDoc>(Collections.projects);
  const projectDocs = await projects.find({ organizationId }).toArray();
  const users = await getCollection<UserDoc>(Collections.users);
  const people = await users.find({ organizationId }).toArray();
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const notes: string[] = [];
  const now = new Date();

  for (const row of table.rows) {
    const taskTitle = cell(row, index, ["task", "tasktitle", "title"]);
    const projectName = cell(row, index, ["project", "projectname"]);
    const project = projectName
      ? projectDocs.find((item) => item.name.trim().toLowerCase() === projectName.toLowerCase())
      : undefined;
    const task = taskDocs.find((item) => {
      if (item.title.trim().toLowerCase() !== taskTitle.toLowerCase()) return false;
      if (project && item.projectId !== project.id) return false;
      return true;
    });
    if (!taskTitle || !task) {
      skippedCount += 1;
      if (taskTitle) notes.push(`Task "${taskTitle}" was not found.`);
      continue;
    }
    const email = cell(row, index, ["employeeemail", "useremail", "assigneeemail", "email"]).toLowerCase();
    const person = email
      ? people.find((item) => (item.email ?? "").toLowerCase() === email)
      : people.find((item) => item.id === user.id);
    if (!person) {
      skippedCount += 1;
      notes.push(email ? `No teammate uses ${email}.` : "Employee email is required.");
      continue;
    }
    const clockIn = parseDate(cell(row, index, ["clockin", "start", "startedat"]));
    const clockOut = parseDate(cell(row, index, ["clockout", "end", "endedat"]));
    const hours = Number(cell(row, index, ["hours", "totalhours", "duration", "durationhours"]));
    let start = clockIn;
    let end = clockOut;
    if (!start && Number.isFinite(hours) && hours > 0) {
      end = end ?? now;
      start = new Date(end.getTime() - hours * 3600 * 1000);
    }
    if (!start || !end) {
      skippedCount += 1;
      notes.push("Each hours row needs a clock-in and clock-out, or an hours value.");
      continue;
    }
    if (end.getTime() < start.getTime()) {
      skippedCount += 1;
      notes.push("Clock-out is earlier than clock-in.");
      continue;
    }
    const durationSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
    await insertDoc<TimeEntryDoc>(Collections.timeEntries, {
      organizationId,
      userId: person.id,
      taskId: task.id,
      projectId: task.projectId ?? project?.id ?? null,
      clockIn: start,
      clockOut: end,
      duration: Math.floor(durationSeconds / 60),
      durationSeconds,
      note: cell(row, index, ["note", "notes"]) || "Imported hours",
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });
    createdCount += 1;
  }
  return { createdCount, updatedCount, skippedCount, notes: uniqueNotes(notes) };
}

async function renderFile(
  table: TabularFile,
  dataset: DataTransferDataset,
  format: DataTransferFormat,
  fileKey: string = dataset,
  title = `${datasetLabel(dataset)} export`,
) {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${fileKey}-${stamp}`;
  if (format === "csv") {
    return {
      fileName: `${base}.csv`,
      mimeType: "text/csv;charset=utf-8",
      base64: Buffer.from(`\uFEFF${toCsv(table)}`, "utf8").toString("base64"),
    };
  }
  if (format === "pdf") {
    const pdf = await toPdf(table, title);
    return { fileName: `${base}.pdf`, mimeType: "application/pdf", base64: pdf.toString("base64") };
  }
  const docx = await toDocx(table, title);
  return {
    fileName: `${base}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    base64: docx.toString("base64"),
  };
}

async function readTable(buffer: Buffer, format: DataTransferFormat, fileName: string): Promise<TabularFile> {
  const lower = fileName.toLowerCase();
  if (format === "csv" || lower.endsWith(".csv")) return parseCsv(buffer.toString("utf8"));
  if (format === "pdf" || lower.endsWith(".pdf")) return parsePdf(buffer);
  if (lower.endsWith(".html") || lower.endsWith(".htm") || buffer.subarray(0, 20).toString("utf8").includes("<")) {
    const html = parseHtmlTable(buffer.toString("utf8"));
    if (html) return html;
  }
  return parseDocx(buffer);
}

async function writeLog(
  user: Actor,
  organizationId: number,
  entry: Omit<DataTransferLogDoc, "id" | "organizationId" | "userId" | "userName" | "createdAt">,
) {
  await insertDoc<DataTransferLogDoc>(Collections.dataTransferLogs, {
    ...entry,
    organizationId,
    userId: user.id,
    userName: user.name?.trim() || user.email || "User",
    createdAt: new Date(),
  });
}

function headerIndex(headers: string[]) {
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    map.set(normalizeHeader(header), index);
  });
  return map;
}

function cell(row: string[], index: Map<string, number>, keys: string[]) {
  for (const key of keys) {
    const at = index.get(key);
    if (at == null) continue;
    const value = row[at];
    if (value != null && value.trim()) return value.trim();
  }
  return "";
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeProjectStatus(value: string): ProjectStatus {
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (PROJECT_STATUSES.has(key as ProjectStatus)) return key as ProjectStatus;
  if (key === "complete" || key === "closed") return "completed";
  if (key === "archive") return "archived";
  return "active";
}

function normalizeTaskStatus(value: string): TaskStatus {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (TASK_STATUSES.has(key as TaskStatus)) return key as TaskStatus;
  if (key === "inprogress" || key === "doing" || key === "progress") return "in_progress";
  if (key === "finished" || key === "complete" || key === "completed") return "done";
  return "todo";
}

function normalizePriority(value: string): TaskPriority {
  const key = value.trim().toLowerCase();
  if (TASK_PRIORITIES.has(key as TaskPriority)) return key as TaskPriority;
  return "medium";
}

function parseDate(value: string) {
  const text = value.trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function uniqueNotes(notes: string[]) {
  return [...new Set(notes)].slice(0, 8);
}

function rememberExport(entry: Omit<PendingExport, "expiresAt">) {
  const now = Date.now();
  for (const [key, pending] of pendingExports) {
    if (pending.expiresAt <= now) pendingExports.delete(key);
  }
  const token = randomBytes(16).toString("hex");
  pendingExports.set(token, { ...entry, expiresAt: now + 10 * 60 * 1000 });
  return token;
}

function takePendingExport(token: string, userId: number, organizationId: number) {
  const pending = pendingExports.get(token);
  pendingExports.delete(token);
  if (!pending || pending.expiresAt <= Date.now() || pending.userId !== userId || pending.organizationId !== organizationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Save the exported file to add it to the log. Export it again if the save was cancelled.",
    });
  }
  return pending;
}

function organizationIdOf(user: Actor) {
  return requireOrganizationId({ id: user.id, organizationId: user.organizationId ?? null });
}

function datasetLabel(dataset: DataTransferDataset) {
  if (dataset === "projects") return "projects";
  if (dataset === "tasks") return "tasks";
  if (dataset === "clients") return "client hours";
  return "task hours";
}

function formatLabel(format: DataTransferFormat) {
  if (format === "csv") return "CSV";
  if (format === "pdf") return "PDF";
  return "Word";
}

async function projectNameMap(organizationId: number) {
  const projects = await getCollection<ProjectDoc>(Collections.projects);
  const docs = await projects.find({ organizationId }).project({ id: 1, name: 1 }).toArray();
  return new Map(docs.map((project) => [project.id, project.name]));
}

async function taskTitleMap(organizationId: number) {
  const tasks = await getCollection<TaskDoc>(Collections.tasks);
  const docs = await tasks.find({ organizationId }).project({ id: 1, title: 1 }).toArray();
  return new Map(docs.map((task) => [task.id, task.title]));
}

async function userEmailMap(organizationId: number) {
  const users = await getCollection<UserDoc>(Collections.users);
  const docs = await users.find({ organizationId }).project({ id: 1, email: 1 }).toArray();
  return new Map(docs.map((user) => [user.id, user.email ?? ""]));
}
