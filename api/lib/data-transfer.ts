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
  TaskActivityDoc,
  TaskDoc,
  TaskPriority,
  TaskStatus,
  TimeEntryDoc,
  UserDoc,
} from "@db/mongo/types";
import { extractTaskTags } from "@/lib/task-tags";
import {
  PROJECT_PIPELINE_STAGES,
  legacyStatusToStage,
  pipelineStageLabel,
  resolveProjectPipelineStages,
  taskPipelineStage,
} from "@/lib/task-kanban";
import { richCommentPlainText } from "@/lib/rich-comment";
import { workZoneDateParts, workZoneWallTimeToUtc } from "@/lib/timezone";
import { loadOrgPipelineStageLabels, loadOrgTaskStatusLabels } from "./org-task-status-labels";
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
const TASK_HEADERS = [
  "Task ID",
  "Created At",
  "Completed At",
  "Last Modified",
  "Name",
  "Section/Column",
  "Assignee",
  "Assignee Email",
  "Start Date",
  "Due Date",
  "Tags",
  "Notes",
  "Projects",
  "Parent task",
  "Blocked By (Dependencies)",
  "Blocking (Dependencies)",
  "Task Status",
  "Priority",
];
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

  if (dataset === "tasks") {
    const missing = missingRequiredHeaders(table.headers, TASK_HEADERS);
    if (missing.length > 0) {
      const message = missingHeaderMessage(missing);
      await writeLog(user, organizationId, {
        action: "import",
        dataset,
        format,
        fileName,
        rowCount: table.rows.length,
        createdCount: 0,
        updatedCount: 0,
        skippedCount: table.rows.length,
        message,
      });
      throw new TRPCError({ code: "BAD_REQUEST", message });
    }
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

  if (dataset === "tasks") return buildTaskSheet(organizationId, scope.projectId);

  if (dataset === "clients") return buildClientHours(organizationId, scope);

  return buildHourTotals(organizationId, scope.projectId, scope.taskId, scope.mode === "totals");
}

async function buildTaskSheet(organizationId: number, projectId: number | null): Promise<TabularFile> {
  const tasks = await getCollection<TaskDoc>(Collections.tasks);
  const filter = projectId != null ? { organizationId, projectId } : { organizationId };
  const docs = await tasks.find(filter).toArray();
  docs.sort((left, right) => (left.number ?? left.id) - (right.number ?? right.id));

  const projects = await getCollection<ProjectDoc>(Collections.projects);
  const projectDocs = await projects.find({ organizationId }).toArray();
  const projectById = new Map(projectDocs.map((project) => [project.id, project]));
  const [orgStageLabels, statusLabels] = await Promise.all([
    loadOrgPipelineStageLabels(organizationId),
    loadOrgTaskStatusLabels(organizationId),
  ]);
  const stagesByProject = new Map<number, ReturnType<typeof resolveProjectPipelineStages>>();
  const stagesFor = (taskProjectId: number | null) => {
    if (taskProjectId == null) return resolveProjectPipelineStages(null, orgStageLabels);
    const cached = stagesByProject.get(taskProjectId);
    if (cached) return cached;
    const resolved = resolveProjectPipelineStages(projectById.get(taskProjectId), orgStageLabels);
    stagesByProject.set(taskProjectId, resolved);
    return resolved;
  };

  const users = await getCollection<UserDoc>(Collections.users);
  const people = await users.find({ organizationId }).project({ id: 1, name: 1, email: 1 }).toArray();
  const personById = new Map(people.map((person) => [person.id, person]));

  const taskIds = docs.map((task) => task.id);
  const activities = await getCollection<TaskActivityDoc>(Collections.taskActivity);
  const completedAt = new Map<number, Date>();
  if (taskIds.length > 0) {
    const events = await activities
      .find({ taskId: { $in: taskIds }, action: "status_changed", newValue: "done" })
      .sort({ createdAt: 1 })
      .toArray();
    for (const event of events) {
      completedAt.set(event.taskId, event.createdAt);
    }
  }

  const rows = docs.map((task) => {
    const person = task.assigneeId != null ? personById.get(task.assigneeId) : undefined;
    const project = task.projectId != null ? projectById.get(task.projectId) : undefined;
    const finished = task.status === "done";
    const completed = finished ? completedAt.get(task.id) ?? task.updatedAt : null;
    const notes = sheetCell(richCommentPlainText(task.description ?? ""));
    const tags = extractTaskTags(task).join(", ");
    const statusKey = task.status;
    const statusLabel =
      statusKey in statusLabels ? statusLabels[statusKey as keyof typeof statusLabels] : task.status;
    return [
      String(task.number ?? task.id),
      formatSheetDateTime(task.createdAt),
      formatSheetDate(completed),
      formatSheetDateTime(task.updatedAt),
      sheetCell(task.title),
      sheetCell(pipelineStageLabel(taskPipelineStage(task), stagesFor(task.projectId))),
      sheetCell(person?.name ?? ""),
      sheetCell(person?.email ?? ""),
      "",
      formatSheetDate(task.dueDate),
      sheetCell(tags),
      notes,
      sheetCell(project?.name ?? ""),
      "",
      "",
      "",
      sheetCell(statusLabel),
      sheetCell(priorityLabel(task.priority)),
    ];
  });

  return { headers: TASK_HEADERS, rows };
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

async function ensureImportedProject(
  user: Actor,
  organizationId: number,
  projectDocs: ProjectDoc[],
  name: string,
  notes: string[],
) {
  const found = projectDocs.find((project) => project.name.trim().toLowerCase() === name.toLowerCase());
  if (found) return found;
  try {
    await assertCanAddProject(organizationId, user.id);
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "Project limit reached.");
    return null;
  }
  const now = new Date();
  const created = await insertDoc<ProjectDoc>(Collections.projects, {
    organizationId,
    name,
    description: null,
    clientName: null,
    status: "active",
    color: null,
    icon: null,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  await joinProject(created.id, user.id);
  projectDocs.push(created);
  notes.push(`Created project "${name}".`);
  await notifyIfProjectLimitReached(organizationId, user.id);
  return created;
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
    const title = cell(row, index, ["name", "title", "task", "tasktitle"]);
    if (!title) {
      skippedCount += 1;
      continue;
    }
    const projectName = cell(row, index, ["projects", "project", "projectname"]);
    const project = projectName
      ? await ensureImportedProject(user, organizationId, projectDocs, projectName, notes)
      : undefined;
    if (projectName && !project) {
      skippedCount += 1;
      continue;
    }
    const assigneeEmail = cell(row, index, ["assigneeemail", "email", "employeeemail"]).toLowerCase();
    const assigneeName = cell(row, index, ["assigneename", "assignee"]);
    const assignee = assigneeEmail
      ? people.find((person) => (person.email ?? "").toLowerCase() === assigneeEmail)
      : assigneeName
        ? people.find((person) => (person.name ?? "").trim().toLowerCase() === assigneeName.toLowerCase())
        : undefined;
    if ((assigneeEmail || assigneeName) && !assignee) {
      notes.push(assigneeEmail ? `No teammate uses ${assigneeEmail}.` : `No teammate is named ${assigneeName}.`);
    }
    const notesCell = cell(row, index, ["notes", "description", "details"]);
    const statusCell = cell(row, index, ["taskstatus", "status"]);
    const priorityCell = cell(row, index, ["priority"]);
    const dueCell = cell(row, index, ["duedate", "due"]);
    const estimatedCell = cell(row, index, ["estimatedhours", "estimate"]);
    const comments = cell(row, index, ["comments", "comment"]);
    const sectionCell = cell(row, index, ["sectioncolumn", "section", "column", "stage"]);
    const projectId = project?.id ?? null;
    const match = existing.find(
      (task) =>
        task.title.trim().toLowerCase() === title.toLowerCase() && (task.projectId ?? null) === projectId,
    );
    const status = statusCell ? normalizeTaskStatus(statusCell) : (match?.status ?? "todo");
    const priority = priorityCell ? normalizePriority(priorityCell) : (match?.priority ?? "medium");
    const dueDate = dueCell ? parseDate(dueCell) : (match?.dueDate ?? null);
    const estimatedHours = estimatedCell || match?.estimatedHours || null;
    const description = notesCell || match?.description || null;
    const stage = stageKeyFromLabel(sectionCell) ?? stageForImportedStatus(status, match?.stage);
    if (match) {
      await updateById<TaskDoc>(Collections.tasks, match.id, {
        description,
        status,
        stage,
        priority,
        assigneeId: assignee?.id ?? match.assigneeId,
        dueDate,
        estimatedHours,
        updatedAt: now,
      });
      match.stage = stage;
      await addImportedComments(match.id, user.id, comments, now);
      updatedCount += 1;
      continue;
    }
    const created = await insertDoc<TaskDoc>(Collections.tasks, {
      organizationId,
      title,
      description,
      status,
      stage,
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
    await addImportedComments(created.id, user.id, comments, now);
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
  const entries = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const entryDocs = (await entries.find({ organizationId, taskId: { $ne: null } }).toArray()) as TimeEntryDoc[];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const notes: string[] = [];
  const now = new Date();
  let hoursCursor = now.getTime();

  for (const row of table.rows) {
    const taskTitle = cell(row, index, ["task", "tasktitle", "title"]);
    const projectName = cell(row, index, ["project", "projectname"]);
    const clockInText = cell(row, index, ["clockin", "start", "startedat"]);
    if (!taskTitle) {
      skippedCount += 1;
      continue;
    }
    if (taskTitle.toLowerCase() === "total" && !clockInText) continue;
    const email = cell(row, index, ["employeeemail", "useremail", "assigneeemail", "email"]).toLowerCase();
    const person = email
      ? people.find((item) => (item.email ?? "").toLowerCase() === email)
      : people.find((item) => item.id === user.id);
    if (!person) {
      skippedCount += 1;
      notes.push(email ? `No teammate uses ${email}.` : "Employee email is required.");
      continue;
    }
    const clockIn = parseDate(clockInText);
    const clockOut = parseDate(cell(row, index, ["clockout", "end", "endedat"]));
    const hours = parseHoursAmount(cell(row, index, ["hours", "totalhours", "duration", "durationhours"]));
    const note = cell(row, index, ["note", "notes"]);
    if (clockIn && clockOut && clockOut.getTime() < clockIn.getTime()) {
      skippedCount += 1;
      notes.push("Clock-out is earlier than clock-in.");
      continue;
    }
    const hasClock = Boolean(clockIn && clockOut);
    if (!hasClock && Number.isFinite(hours) && hours <= 0) continue;
    if (!hasClock && !Number.isFinite(hours)) {
      skippedCount += 1;
      notes.push("Each hours row needs a clock-in and clock-out, or an hours value.");
      continue;
    }
    const project = projectName
      ? await ensureImportedProject(user, organizationId, projectDocs, projectName, notes)
      : undefined;
    if (projectName && !project) {
      skippedCount += 1;
      continue;
    }
    let task = taskDocs.find((item) => {
      if (item.title.trim().toLowerCase() !== taskTitle.toLowerCase()) return false;
      if (project && item.projectId !== project.id) return false;
      if (!project && projectName) return false;
      return true;
    });
    if (!task) {
      task = await insertDoc<TaskDoc>(Collections.tasks, {
        organizationId,
        title: taskTitle,
        description: null,
        status: "todo",
        stage: "new",
        priority: "medium",
        assigneeId: person.id,
        projectId: project?.id ?? null,
        createdBy: user.id,
        dueDate: null,
        estimatedHours: null,
        actualHours: null,
        position: 0,
        createdAt: now,
        updatedAt: now,
      });
      taskDocs.push(task);
      notes.push(`Created task "${taskTitle}".`);
    }
    const taskEntries = entryDocs.filter((entry) => entry.taskId === task.id);
    if (hasClock && clockIn && clockOut) {
      const duplicate = taskEntries.some(
        (entry) =>
          entry.userId === person.id &&
          entry.clockOut &&
          Math.abs(new Date(entry.clockIn).getTime() - clockIn.getTime()) < 60_000 &&
          Math.abs(new Date(entry.clockOut).getTime() - clockOut.getTime()) < 60_000,
      );
      if (duplicate) {
        updatedCount += 1;
        continue;
      }
      const saved = await insertImportedTime(organizationId, person.id, task, clockIn, clockOut, note, now);
      entryDocs.push(saved);
      createdCount += 1;
      continue;
    }
    const wantedSeconds = Math.round(hours * 3600);
    const existingSeconds = taskEntries.reduce((sum, entry) => sum + entrySeconds(entry), 0);
    if (existingSeconds >= wantedSeconds - 1) {
      updatedCount += 1;
      continue;
    }
    const gapSeconds = wantedSeconds - existingSeconds;
    const end = new Date(hoursCursor);
    const start = new Date(end.getTime() - gapSeconds * 1000);
    hoursCursor = start.getTime();
    const saved = await insertImportedTime(organizationId, person.id, task, start, end, note, now);
    entryDocs.push(saved);
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

function missingRequiredHeaders(headers: string[], required: string[]) {
  const present = new Set(headers.map((header) => normalizeHeader(header)));
  return required.filter((header) => !present.has(normalizeHeader(header)));
}

function missingHeaderMessage(missing: string[]) {
  const names = missing.join(", ");
  if (missing.length === 1) return `Missing field "${names}"`;
  return `Missing fields "${names}"`;
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
  if (key === "pause" || key === "paused" || key === "on_hold") return "review";
  if (key === "not_started" || key === "notstarted") return "todo";
  return "todo";
}

function stageKeyFromLabel(value: string) {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const match = PROJECT_PIPELINE_STAGES.find(
    (stage) => stage.label.toLowerCase() === text || stage.key === text.replace(/[\s/-]+/g, "_"),
  );
  return match?.key ?? null;
}

function sheetCell(value: string) {
  return value.replace(/\r?\n+/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

function formatSheetDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = workZoneDateParts(date);
  return `${padSheet(parts.day)}-${padSheet(parts.month)}-${parts.year}`;
}

function formatSheetDateTime(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = workZoneDateParts(date);
  return `${padSheet(parts.day)}-${padSheet(parts.month)}-${parts.year} ${padSheet(parts.hour)}:${padSheet(parts.minute)}:${padSheet(parts.second)}`;
}

function padSheet(value: number) {
  return String(value).padStart(2, "0");
}

function priorityLabel(value: string) {
  const key = value.trim().toLowerCase();
  if (key === "low") return "Low";
  if (key === "medium") return "Medium";
  if (key === "high") return "High";
  if (key === "urgent") return "Urgent";
  return value.trim();
}

function normalizePriority(value: string): TaskPriority {
  const key = value.trim().toLowerCase();
  if (TASK_PRIORITIES.has(key as TaskPriority)) return key as TaskPriority;
  return "medium";
}

async function addImportedComments(taskId: number, userId: number, raw: string, now: Date) {
  const lines = raw
    .split(/\r?\n|\s+\|\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return;
  const activities = await getCollection<TaskActivityDoc>(Collections.taskActivity);
  const existing = await activities.find({ taskId, action: "commented" }).toArray();
  const have = new Set(
    existing.map((item) => richCommentPlainText(item.newValue ?? "").trim().toLowerCase()).filter(Boolean),
  );
  for (const line of lines) {
    const key = line.toLowerCase();
    if (have.has(key)) continue;
    await insertDoc<TaskActivityDoc>(Collections.taskActivity, {
      taskId,
      userId,
      action: "commented",
      oldValue: null,
      newValue: line,
      metadata: null,
      createdAt: now,
    });
    have.add(key);
  }
}

function stageForImportedStatus(status: TaskStatus, current?: string | null) {
  if (status === "todo" && current && current !== "new") return current;
  return legacyStatusToStage(status);
}

function parseHoursAmount(value: string) {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return Number.NaN;
  return Number(match[1]);
}

async function insertImportedTime(
  organizationId: number,
  userId: number,
  task: TaskDoc,
  start: Date,
  end: Date,
  note: string,
  now: Date,
) {
  const durationSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
  return insertDoc<TimeEntryDoc>(Collections.timeEntries, {
    organizationId,
    userId,
    taskId: task.id,
    projectId: task.projectId ?? null,
    clockIn: start,
    clockOut: end,
    duration: Math.floor(durationSeconds / 60),
    durationSeconds,
    note: note || "Imported hours",
    source: "manual",
    createdAt: now,
    updatedAt: now,
  });
}

function parseDate(value: string) {
  const text = value.trim();
  if (!text) return null;
  const local = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (local) {
    return workZoneWallTimeToUtc(
      Number(local[3]),
      Number(local[2]),
      Number(local[1]),
      Number(local[4] ?? 12),
      Number(local[5] ?? 0),
      Number(local[6] ?? 0),
      0,
    );
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
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

