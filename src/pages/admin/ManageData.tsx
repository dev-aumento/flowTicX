import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Database, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";

type Dataset = "projects" | "tasks" | "hours";
type FileFormat = "csv" | "pdf" | "docx";

const DATASETS: { id: Dataset; label: string; columns: string }[] = [
  {
    id: "projects",
    label: "Projects",
    columns: "Name, Description, Client, Status",
  },
  {
    id: "tasks",
    label: "Tasks",
    columns: "Title, Description, Project, Status, Priority, Assignee email, Due date, Estimated hours",
  },
  {
    id: "hours",
    label: "Task hours",
    columns: "Task, Project, Employee email, Clock in, Clock out, Hours, Note",
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

function downloadBase64(base64: string, fileName: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const logsQuery = trpc.dataTransfer.logs.useQuery();
  const selected = DATASETS.find((item) => item.id === dataset) ?? DATASETS[0];
  const accept = FORMATS.find((item) => item.id === format)?.accept ?? ".csv";

  const exportMutation = trpc.dataTransfer.export.useMutation({
    onSuccess: async (file) => {
      downloadBase64(file.base64, file.fileName, file.mimeType);
      toast.success(`Exported ${file.rowCount} rows`);
      await utils.dataTransfer.logs.invalidate();
    },
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

  async function onImportFile(file: File | undefined) {
    if (!file) return;
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

  const busy = exportMutation.isPending || importMutation.isPending;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F2937]">Manage data</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Import and export projects, tasks, and task hours. Every run is listed in the log below.
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
                  className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-[#111827]"
                >
                  {DATASETS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-[#111827]">File type</span>
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as FileFormat)}
                  className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-[#111827]"
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
              Columns for {selected.label}: {selected.columns}
            </p>
            <p className="text-sm text-gray-500">
              Matching projects and tasks are updated. Task hours are added as new entries. Dates use
              ISO format, for example 2026-09-29T09:00:00.000Z. CSV is the most reliable file. PDF and
              Word imports read the files exported from this page.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => exportMutation.mutate({ dataset, format })}
                className="gap-2 bg-[#2563EB] hover:bg-[#1D4ED8]"
              >
                {exportMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export
              </Button>
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
                      {log.dataset === "hours" ? "Task hours" : log.dataset} · {log.format === "docx" ? "Word" : log.format.toUpperCase()}
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
