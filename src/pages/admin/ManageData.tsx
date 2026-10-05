import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Database, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";

type Dataset = "projects" | "tasks" | "hours" | "clients";
type FileFormat = "csv" | "pdf" | "docx";
type TaskScope = "all" | "project";
type HourScope = "all" | "project" | "task" | "totals";
type ClientScope = "projects" | "tasks";

const selectClass = "h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-[#111827]";

const DATASETS: { id: Dataset; label: string; columns: string }[] = [
  {
    id: "projects",
    label: "Projects",
    columns: "Name, Description, Client, Status",
  },
  {
    id: "tasks",
    label: "Tasks",
    columns:
      "Task ID, Created At, Completed At, Last Modified, Name, Section/Column, Assignee, Assignee Email, Start Date, Due Date, Tags, Notes, Projects, Parent task, Blocked By (Dependencies), Blocking (Dependencies), Task Status, Priority",
  },
  {
    id: "hours",
    label: "Task hours",
    columns: "Project, Task, Total hours (or Clock in and Clock out)",
  },
  {
    id: "clients",
    label: "Clients",
    columns: "Project name, Total hours of all tasks",
  },
];

const FORMATS: { id: FileFormat; label: string; accept: string }[] = [
  { id: "csv", label: "CSV", accept: ".csv,text/csv" },
  { id: "pdf", label: "PDF", accept: ".pdf,application/pdf" },
  { id: "docx", label: "Word", accept: ".doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
];

function formatFromFile(fileName: string): FileFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "docx";
  return null;
}

type SaveHandle = {
  name: string;
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

function bytesFromBase64(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function chooseSaveLocation(fileName: string, format: FileFormat): Promise<SaveHandle | "cancelled" | null> {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<SaveHandle>;
  }).showSaveFilePicker;
  if (!picker) return null;

  const types: Record<FileFormat, { description: string; accept: Record<string, string[]> }> = {
    csv: { description: "CSV", accept: { "text/csv": [".csv"] } },
    pdf: { description: "PDF", accept: { "application/pdf": [".pdf"] } },
    docx: {
      description: "Word",
      accept: {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      },
    },
  };

  try {
    return await picker({ suggestedName: fileName, types: [types[format]] });
  } catch (error) {
    if (isAbortError(error)) return "cancelled";
    return null;
  }
}

async function writeSavedFile(handle: SaveHandle, blob: Blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return handle.name;
}

function downloadBlob(blob: Blob, fileName: string) {
  return new Promise<string>((resolve) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(fileName);
    }, 1500);
  });
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function formatWhen(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminManageData() {
  const [dataset, setDataset] = useState<Dataset>("projects");
  const [format, setFormat] = useState<FileFormat>("csv");
  const [taskScope, setTaskScope] = useState<TaskScope>("all");
  const [hourScope, setHourScope] = useState<HourScope>("all");
  const [clientScope, setClientScope] = useState<ClientScope>("projects");
  const [clientName, setClientName] = useState("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [taskId, setTaskId] = useState<number | "">("");
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const logsQuery = trpc.dataTransfer.logs.useQuery();
  const choicesQuery = trpc.dataTransfer.choices.useQuery(undefined, {
    enabled: dataset === "tasks" || dataset === "hours" || dataset === "clients",
  });
  const selected = DATASETS.find((item) => item.id === dataset) ?? DATASETS[0];
  const accept = FORMATS.find((item) => item.id === format)?.accept ?? ".csv";

  const exportMutation = trpc.dataTransfer.export.useMutation({
    onError: (error) => toast.error(error.message),
  });
  const confirmExportMutation = trpc.dataTransfer.confirmExport.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const importMutation = trpc.dataTransfer.import.useMutation({
    onSuccess: async (result) => {
      toast.success(result.message);
      await utils.dataTransfer.logs.invalidate();
    },
    onError: async (error) => {
      toast.error(error.message);
      await utils.dataTransfer.logs.invalidate();
    },
  });

  const projects = choicesQuery.data?.projects ?? [];
  const clients = choicesQuery.data?.clients ?? [];
  const visibleTasks = (choicesQuery.data?.tasks ?? []).filter((task) =>
    projectId === "" ? true : task.projectId === projectId,
  );
  const showProject =
    (dataset === "tasks" && taskScope === "project") ||
    (dataset === "hours" && hourScope !== "all");
  const projectOptional = dataset === "hours" && (hourScope === "totals" || hourScope === "task");
  const showTask = dataset === "hours" && hourScope === "task";
  const columnText =
    dataset === "clients" && clientScope === "tasks"
      ? "Project name, Task, Hours, and a total for each project"
      : dataset === "hours" && hourScope === "totals"
        ? "Project, Task, Time entries, Total hours"
        : selected.columns;

  function exportScope() {
    if (dataset === "clients") {
      if (!clientName.trim()) {
        toast.error("Choose a client.");
        return null;
      }
      return {
        mode: clientScope === "projects" ? ("client-projects" as const) : ("client-tasks" as const),
        projectId: null,
        taskId: null,
        clientName: clientName.trim(),
      };
    }
    if (dataset === "tasks") {
      if (taskScope === "all") return { mode: "all" as const, projectId: null, taskId: null, clientName: null };
      if (projectId === "") {
        toast.error("Choose a project.");
        return null;
      }
      return { mode: "project" as const, projectId, taskId: null, clientName: null };
    }
    if (dataset === "hours") {
      if (hourScope === "all") return { mode: "all" as const, projectId: null, taskId: null, clientName: null };
      if (hourScope === "project") {
        if (projectId === "") {
          toast.error("Choose a project.");
          return null;
        }
        return { mode: "project" as const, projectId, taskId: null, clientName: null };
      }
      if (hourScope === "task") {
        if (taskId === "") {
          toast.error("Choose a task.");
          return null;
        }
        return { mode: "task" as const, projectId: projectId === "" ? null : projectId, taskId, clientName: null };
      }
      return { mode: "totals" as const, projectId: projectId === "" ? null : projectId, taskId: null, clientName: null };
    }
    return { mode: "all" as const, projectId: null, taskId: null, clientName: null };
  }

  async function onExport() {
    const scope = exportScope();
    if (!scope) return;
    const extension = format === "docx" ? "docx" : format;
    const clientSlug = clientName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    const fileKey =
      dataset === "clients"
        ? `client-${clientSlug || "client"}-${clientScope === "projects" ? "project-totals" : "task-hours"}`
        : dataset === "hours" && hourScope === "totals"
          ? "hours-totals"
          : dataset === "hours" && hourScope === "task"
            ? "hours-task"
            : dataset === "hours" && hourScope === "project"
              ? "hours-project"
              : dataset === "tasks" && taskScope === "project"
                ? "tasks-project"
                : dataset;
    const suggestedName = `${fileKey}-${new Date().toISOString().slice(0, 10)}.${extension}`;
    const destination = await chooseSaveLocation(suggestedName, format);
    if (destination === "cancelled") return;

    setExporting(true);
    try {
      const file = await exportMutation.mutateAsync({ dataset, format, scope });
      const blob = bytesFromBase64(file.base64, file.mimeType);
      const savedName = destination
        ? await writeSavedFile(destination, blob)
        : await downloadBlob(blob, file.fileName);
      await confirmExportMutation.mutateAsync({ token: file.token, fileName: savedName });
      toast.success(`Exported ${file.rowCount} rows`);
      await utils.dataTransfer.logs.invalidate();
    } catch (error) {
      if (isAbortError(error)) return;
      if (!(error instanceof Error) || !("data" in error)) {
        toast.error(error instanceof Error ? error.message : "The file could not be saved.");
      }
    } finally {
      setExporting(false);
    }
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    if (dataset === "clients") {
      toast.error("Client hours can only be exported.");
      return;
    }
    const fileFormat = formatFromFile(file.name);
    if (!fileFormat) {
      toast.error("Choose a CSV, PDF, or Word file.");
      return;
    }
    if (file.size > 8_000_000) {
      toast.error("The file is larger than 8 MB.");
      return;
    }
    setFormat(fileFormat);
    try {
      const base64 = await readFileAsBase64(file);
      await importMutation.mutateAsync({
        dataset,
        format: fileFormat,
        fileName: file.name,
        base64,
      });
    } catch {
      // The mutation already reports the error.
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const busy = exporting || importMutation.isPending;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F2937]">Manage data</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Import and export projects, tasks, and task hours. Client exports list hours for one client. A log row is added after a file is saved or an import finishes.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <Database size={18} className="mt-0.5 text-[#2563EB]" />
          <div className="min-w-0 flex-1 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-[#111827]">What to move</span>
                <select
                  value={dataset}
                  onChange={(event) => setDataset(event.target.value as Dataset)}
                  className={selectClass}
                >
                  {DATASETS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {dataset === "tasks" ? (
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-[#111827]">Tasks to export</span>
                  <select
                    value={taskScope}
                    onChange={(event) => setTaskScope(event.target.value as TaskScope)}
                    className={selectClass}
                  >
                    <option value="all">Overall tasks</option>
                    <option value="project">A specific project</option>
                  </select>
                </label>
              ) : null}
              {dataset === "hours" ? (
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-[#111827]">Hours to export</span>
                  <select
                    value={hourScope}
                    onChange={(event) => setHourScope(event.target.value as HourScope)}
                    className={selectClass}
                  >
                    <option value="all">Overall task hours</option>
                    <option value="project">A specific project</option>
                    <option value="task">A specific task</option>
                    <option value="totals">Project totals, task by task</option>
                  </select>
                </label>
              ) : null}
              {dataset === "clients" ? (
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-[#111827]">Client</span>
                  <select
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                    className={selectClass}
                  >
                    <option value="">Choose a client</option>
                    {clients.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {dataset === "clients" && clientName ? (
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-[#111827]">How to export</span>
                  <select
                    value={clientScope}
                    onChange={(event) => setClientScope(event.target.value as ClientScope)}
                    className={selectClass}
                  >
                    <option value="projects">Project wise total</option>
                    <option value="tasks">Task wise hours</option>
                  </select>
                </label>
              ) : null}
              {showProject ? (
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-[#111827]">Project</span>
                  <select
                    value={projectId === "" ? "" : String(projectId)}
                    onChange={(event) => {
                      const next = event.target.value ? Number(event.target.value) : "";
                      setProjectId(next);
                      setTaskId("");
                    }}
                    className={selectClass}
                  >
                    <option value="">{projectOptional ? "All projects" : "Choose a project"}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {showTask ? (
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-[#111827]">Task</span>
                  <select
                    value={taskId === "" ? "" : String(taskId)}
                    onChange={(event) => setTaskId(event.target.value ? Number(event.target.value) : "")}
                    className={selectClass}
                  >
                    <option value="">Choose a task</option>
                    {visibleTasks.map((task) => {
                      const projectName = projects.find((project) => project.id === task.projectId)?.name;
                      const label = projectId === "" && projectName ? `${task.title} — ${projectName}` : task.title;
                      return (
                        <option key={task.id} value={task.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : null}
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-[#111827]">File type</span>
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as FileFormat)}
                  className={selectClass}
                >
                  {FORMATS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="text-sm text-[#111827]">
              Columns for {selected.label}: {columnText}
            </p>
            <p className="text-sm text-gray-500">
              {dataset === "clients"
                ? !clientName
                  ? "Choose a client, then export either one total for each project or each task with a project total."
                  : clientScope === "projects"
                    ? "Each project for the selected client is exported with the combined hours of all its tasks."
                    : "Each project lists its tasks and hours, then a total for that project. Separate time entries on the same task are added together."
                : "Task export puts the column names in the first row and one task on each following row. An empty value stays a blank cell. Dates use DD-MM-YYYY. Import creates a missing project or task, updates a match, adds comments separated by |, and sets the hours. Hours can be a total, or a clock-in and clock-out. CSV is the most reliable file. PDF and Word imports read the files exported from this page."}
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void onExport()}
                className="gap-2 bg-[#2563EB] hover:bg-[#1D4ED8]"
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export
              </Button>
              {dataset === "clients" ? null : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  className="gap-2"
                >
                  {importMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Import
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(event) => void onImportFile(event.target.files?.[0])}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-[#111827]">Activity log</h2>
          <p className="mt-0.5 text-sm text-gray-500">Imports and exports for this workspace.</p>
        </div>
        {logsQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={28} className="animate-spin text-gray-400" />
          </div>
        ) : logsQuery.data && logsQuery.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-gray-50 text-[#111827]">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {logsQuery.data.map((log) => (
                  <tr key={log.id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-[#111827]">{formatWhen(log.createdAt)}</td>
                    <td className="px-4 py-3 text-[#111827]">{log.userName}</td>
                    <td className="px-4 py-3 capitalize text-[#111827]">{log.action}</td>
                    <td className="px-4 py-3 capitalize text-[#111827]">
                      {log.dataset === "hours" ? "Task hours" : log.dataset === "clients" ? "Clients" : log.dataset} · {log.format === "docx" ? "Word" : log.format.toUpperCase()}
                    </td>
                    <td className="px-4 py-3 text-[#111827]">{log.fileName}</td>
                    <td className="px-4 py-3 text-[#111827]">
                      <div>
                        {log.action === "export"
                          ? `${log.rowCount} rows`
                          : `${log.createdCount} created, ${log.updatedCount} updated, ${log.skippedCount} skipped`}
                      </div>
                      <div className="mt-1 text-gray-500">{log.message}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-10 text-sm text-[#111827]">No imports or exports yet.</p>
        )}
      </div>
    </motion.div>
  );
}
