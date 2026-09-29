import { TRPCError } from "@trpc/server";
import { Collections } from "@db/mongo/collections";
import type {
  DataTransferDataset,
  DataTransferFormat,
  DataTransferLogDoc,
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
};

const PROJECT_HEADERS = ["Name", "Description", "Client", "Status"];
const TASK_HEADERS = ["Title", "Description", "Project", "Status", "Priority", "Assignee email", "Due date", "Estimated hours"];
const HOUR_HEADERS = ["Task", "Project", "Employee email", "Clock in", "Clock out", "Hours", "Note"];

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

export async function exportDataset(user: Actor, dataset: DataTransferDataset, format: DataTransferFormat) {
  assertCanManageData(user);
  const organizationId = organizationIdOf(user);
  await assertPlanFeature(user, DATASET_FEATURE[dataset]);
  const table = await buildTable(organizationId, dataset);
  const file = await renderFile(table, dataset, format);
  await writeLog(user, organizationId, {
    action: "export",
    dataset,
    format,
    fileName: file.fileName,
    rowCount: table.rows.length,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    message: `Exported ${table.rows.length} ${datasetLabel(dataset)} as ${formatLabel(format)}.`,
  });
  return { ...file, rowCount: table.rows.length };
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

async function buildTable(organizationId: number, dataset: DataTransferDataset): Promise<TabularFile> {
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
    const docs = await tasks.find({ organizationId }).sort({ createdAt: -1 }).toArray();
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

  const entries = await getCollection<TimeEntryDoc>(Collections.timeEntries);
  const docs = await entries
    .find({ organizationId, taskId: { $ne: null } })
    .sort({ clockIn: -1 })
    .limit(5000)
    .toArray();
  const projectMap = await projectNameMap(organizationId);
  const taskMap = await taskTitleMap(organizationId);
  const userMap = await userEmailMap(organizationId);
  return {
    headers: HOUR_HEADERS,
    rows: docs.map((entry) => {
      const seconds =
        typeof entry.durationSeconds === "number" && entry.durationSeconds >= 0
          ? entry.durationSeconds
          : entry.clockOut
            ? Math.max(0, Math.floor((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 1000))
            : 0;
      return [
        entry.taskId != null ? taskMap.get(entry.taskId) ?? "" : "",
        entry.projectId != null ? projectMap.get(entry.projectId) ?? "" : "",
        userMap.get(entry.userId) ?? "",
        toIso(entry.clockIn),
        entry.clockOut ? toIso(entry.clockOut) : "",
        (seconds / 3600).toFixed(2),
        entry.note ?? "",
      ];
    }),
  };
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
    const hours = Number(cell(row, index, ["hours", "duration", "durationhours"]));
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

async function renderFile(table: TabularFile, dataset: DataTransferDataset, format: DataTransferFormat) {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${dataset}-${stamp}`;
  const title = `${datasetLabel(dataset)} export`;
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

function organizationIdOf(user: Actor) {
  return requireOrganizationId({ id: user.id, organizationId: user.organizationId ?? null });
}

function datasetLabel(dataset: DataTransferDataset) {
  if (dataset === "projects") return "projects";
  if (dataset === "tasks") return "tasks";
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
