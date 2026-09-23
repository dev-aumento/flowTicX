import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router";
import { motion } from "framer-motion";
import {
  UserMinus,
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  FileUp,
  Download,
  Paperclip,
  ChevronDown,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { canManageLeaves } from "@/lib/leave-policy";
import { hasPermission } from "@/lib/permissions";
import { formatWorkZoneDateKey, formatWorkZoneDateTime } from "@/lib/timezone";
import { downloadFileFromBase64, readFileAsBase64 } from "@/lib/task-files";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type FormerForm = {
  name: string;
  email: string;
  department: string;
  position: string;
  joiningDate: string;
  resignationDate: string;
  servedNoticePeriod: boolean;
  noticePeriodDays: string;
  lastWorkingDay: string;
  reasonForLeaving: string;
  notes: string;
};

const EMPTY_FORM: FormerForm = {
  name: "",
  email: "",
  department: "",
  position: "",
  joiningDate: "",
  resignationDate: "",
  servedNoticePeriod: false,
  noticePeriodDays: "",
  lastWorkingDay: "",
  reasonForLeaving: "",
  notes: "",
};

const inputClass =
  "w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

function formatDocSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function noticePeriodLabel(employee: {
  servedNoticePeriod: boolean;
  noticePeriodDays?: number | null;
}) {
  return employee.servedNoticePeriod
    ? `Served${employee.noticePeriodDays != null ? ` (${employee.noticePeriodDays}d)` : ""}`
    : "Not served";
}

function FormerEmployeeDetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-sm text-[#1F2937] text-right min-w-0 break-words">{value}</span>
    </div>
  );
}

export default function RecentEmployees() {
  const { user } = useAuth();
  const allowed = canManageLeaves(user) || hasPermission(user, "employees.manage");
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormerForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [docLabel, setDocLabel] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const { data, isLoading } = trpc.formerEmployees.list.useQuery(
    { search: search.trim() || undefined },
    { enabled: allowed },
  );

  const { data: docsData, isLoading: docsLoading } =
    trpc.formerEmployees.listDocuments.useQuery(
      { formerEmployeeId: editingId! },
      { enabled: allowed && dialogOpen && editingId != null },
    );

  const createMutation = trpc.formerEmployees.create.useMutation();
  const updateMutation = trpc.formerEmployees.update.useMutation();
  const deleteMutation = trpc.formerEmployees.delete.useMutation({
    onSuccess: async () => {
      await utils.formerEmployees.list.invalidate();
    },
  });
  const uploadMutation = trpc.formerEmployees.uploadDocument.useMutation();
  const deleteDocMutation = trpc.formerEmployees.deleteDocument.useMutation({
    onSuccess: async () => {
      if (editingId != null) {
        await utils.formerEmployees.listDocuments.invalidate({
          formerEmployeeId: editingId,
        });
      }
    },
    onError: (error) => setFormError(error.message || "Could not delete document."),
  });

  useEffect(() => {
    if (!dialogOpen) setFormError(null);
  }, [dialogOpen]);

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDocLabel("");
    setPendingFiles([]);
    setUploading(false);
    setSaving(false);
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDocLabel("");
    setPendingFiles([]);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(employee: NonNullable<typeof data>["employees"][number]) {
    setEditingId(employee.id);
    setForm({
      name: employee.name,
      email: employee.email ?? "",
      department: employee.department ?? "",
      position: employee.position ?? "",
      joiningDate: employee.joiningDate,
      resignationDate: employee.resignationDate,
      servedNoticePeriod: employee.servedNoticePeriod,
      noticePeriodDays:
        employee.noticePeriodDays != null ? String(employee.noticePeriodDays) : "",
      lastWorkingDay: employee.lastWorkingDay,
      reasonForLeaving: employee.reasonForLeaving,
      notes: employee.notes ?? "",
    });
    setDocLabel("");
    setPendingFiles([]);
    setFormError(null);
    setDialogOpen(true);
  }

  async function uploadFilesForEmployee(formerEmployeeId: number, files: File[], label: string | null) {
    for (const file of files) {
      const dataBase64 = await readFileAsBase64(file);
      await uploadMutation.mutateAsync({
        formerEmployeeId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        label,
        dataBase64,
      });
    }
    await utils.formerEmployees.listDocuments.invalidate({ formerEmployeeId });
  }

  function queuePendingFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    const tooLarge = selected.find((file) => file.size > 20 * 1024 * 1024);
    if (tooLarge) {
      setFormError(`"${tooLarge.name}" is too large. Maximum size is 20 MB per file.`);
      return;
    }
    setFormError(null);
    setPendingFiles((prev) => [...prev, ...selected]);
  }

  async function handleUploadExisting(files: FileList | null) {
    if (!files?.length || editingId == null) return;
    const selected = Array.from(files);
    const tooLarge = selected.find((file) => file.size > 20 * 1024 * 1024);
    if (tooLarge) {
      setFormError(`"${tooLarge.name}" is too large. Maximum size is 20 MB per file.`);
      return;
    }

    setUploading(true);
    const sharedLabel = docLabel.trim() || null;
    let uploadedCount = 0;
    try {
      for (const file of selected) {
        const dataBase64 = await readFileAsBase64(file);
        await uploadMutation.mutateAsync({
          formerEmployeeId: editingId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          label: sharedLabel,
          dataBase64,
        });
        uploadedCount += 1;
      }
      setDocLabel("");
      await utils.formerEmployees.listDocuments.invalidate({
        formerEmployeeId: editingId,
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : uploadedCount > 0
            ? `Uploaded ${uploadedCount} file(s), then failed on the next one.`
            : "Could not upload files.",
      );
      if (uploadedCount > 0) {
        await utils.formerEmployees.listDocuments.invalidate({
          formerEmployeeId: editingId,
        });
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(docId: number, fileName: string, mimeType: string) {
    setDownloadingId(docId);
    try {
      const full = await utils.formerEmployees.getDocument.fetch({ id: docId });
      if (!full?.dataBase64) {
        setFormError("Could not download document.");
        return;
      }
      downloadFileFromBase64(fileName, mimeType, full.dataBase64);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not download document.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleSave() {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Employee name is required.");
      return;
    }
    if (!form.joiningDate || !form.resignationDate || !form.lastWorkingDay) {
      setFormError("Joining date, resignation date, and last working day are required.");
      return;
    }
    if (!form.reasonForLeaving.trim()) {
      setFormError("Reason for leaving is required.");
      return;
    }
    if (form.servedNoticePeriod && !form.noticePeriodDays.trim()) {
      setFormError("Enter how many notice days were served.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      department: form.department.trim() || null,
      position: form.position.trim() || null,
      joiningDate: form.joiningDate,
      resignationDate: form.resignationDate,
      servedNoticePeriod: form.servedNoticePeriod,
      noticePeriodDays: form.servedNoticePeriod
        ? Number(form.noticePeriodDays)
        : null,
      lastWorkingDay: form.lastWorkingDay,
      reasonForLeaving: form.reasonForLeaving.trim(),
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      if (editingId != null) {
        await updateMutation.mutateAsync({ id: editingId, ...payload });
        await utils.formerEmployees.list.invalidate();
        closeDialog();
        return;
      }

      const result = await createMutation.mutateAsync(payload);
      const newId = result.employee.id;
      if (pendingFiles.length > 0) {
        setUploading(true);
        await uploadFilesForEmployee(newId, pendingFiles, docLabel.trim() || null);
      }
      await utils.formerEmployees.list.invalidate();
      closeDialog();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save record.");
    } finally {
      setUploading(false);
      setSaving(false);
    }
  }

  const employees = data?.employees ?? [];
  const documents = docsData?.documents ?? [];
  const sortedEmployees = useMemo(() => employees, [employees]);
  const busy = saving || uploading;

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Recent employees</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track employees who have left the company — joining, resignation, notice, and documents.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-[#2563EB] hover:bg-[#1D4ED8] gap-2">
          <Plus size={16} />
          Add record
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, department, reason…"
          aria-label="Search former employees"
          className="h-10 w-full rounded-lg border border-[#D1D5DB] bg-white pl-9 pr-3 text-xs text-[#1F2937] placeholder:text-xs placeholder:text-gray-400 outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 md:h-10 md:text-sm md:placeholder:text-sm dark:border-[#64748b] dark:bg-[#151c2c] dark:text-white dark:placeholder:text-slate-400"
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={28} className="animate-spin text-gray-400" />
          </div>
        ) : sortedEmployees.length === 0 ? (
          <div className="py-16 text-center">
            <UserMinus size={36} className="mx-auto text-gray-200 mb-2" />
            <p className="text-sm text-gray-500">No former employee records yet</p>
            <p className="text-xs text-gray-400 mt-1">Add a record for someone who left the company.</p>
          </div>
        ) : (
          <div>
            <div className="lg:hidden divide-y divide-gray-100">
              {sortedEmployees.map((employee) => {
                const expanded = expandedId === employee.id;
                const subtitle =
                  [employee.position, employee.department, employee.email]
                    .filter(Boolean)
                    .join(" · ") || "—";
                return (
                  <div key={employee.id} className="bg-white">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(expanded ? null : employee.id)
                      }
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[#1F2937]">
                          {employee.name}
                        </div>
                        <div className="truncate text-xs text-gray-500">
                          {subtitle}
                        </div>
                      </div>
                      <ChevronDown
                        size={18}
                        className={cn(
                          "shrink-0 text-gray-400 transition-transform",
                          expanded && "rotate-180",
                        )}
                      />
                    </button>
                    {expanded ? (
                      <div className="space-y-1 border-t border-gray-100 bg-gray-50 px-1.5 py-1.5 dark:border-[#2d3a4f] dark:bg-[#1a2336]">
                        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 divide-y divide-gray-100">
                          <FormerEmployeeDetailRow
                            label="Joined"
                            value={formatWorkZoneDateKey(employee.joiningDate)}
                          />
                          <FormerEmployeeDetailRow
                            label="Resigned"
                            value={formatWorkZoneDateKey(employee.resignationDate)}
                          />
                          <FormerEmployeeDetailRow
                            label="Last day"
                            value={formatWorkZoneDateKey(employee.lastWorkingDay)}
                          />
                          <FormerEmployeeDetailRow
                            label="Notice"
                            value={noticePeriodLabel(employee)}
                          />
                          <div className="py-1.5">
                            <div className="text-xs text-gray-500">Reason</div>
                            <p className="mt-1 text-sm text-[#1F2937] whitespace-pre-wrap">
                              {employee.reasonForLeaving}
                            </p>
                          </div>
                          {employee.notes ? (
                            <div className="py-1.5">
                              <div className="text-xs text-gray-500">Notes</div>
                              <p className="mt-1 text-sm text-[#1F2937] whitespace-pre-wrap">
                                {employee.notes}
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(employee)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const ok = window.confirm(
                                `Delete record for "${employee.name}"? This also removes their documents.`,
                              );
                              if (!ok) return;
                              deleteMutation.mutate({ id: employee.id });
                            }}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3 whitespace-nowrap">Joined</th>
                  <th className="px-4 py-3 whitespace-nowrap">Resigned</th>
                  <th className="px-4 py-3 whitespace-nowrap">Last day</th>
                  <th className="px-4 py-3">Notice</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.map((employee) => (
                  <tr key={employee.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#1F2937]">{employee.name}</div>
                      <div className="text-xs text-gray-400">
                        {[employee.position, employee.department, employee.email]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {formatWorkZoneDateKey(employee.joiningDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {formatWorkZoneDateKey(employee.resignationDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {formatWorkZoneDateKey(employee.lastWorkingDay)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {noticePeriodLabel(employee)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-[220px]">
                      <span className="line-clamp-2">{employee.reasonForLeaving}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(employee)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#3d3d3d] text-gray-500"
                          title="Edit / documents"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const ok = window.confirm(
                              `Delete record for "${employee.name}"? This also removes their documents.`,
                            );
                            if (!ok) return;
                            deleteMutation.mutate({ id: employee.id });
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#3d3d3d] text-red-500"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && !busy && closeDialog()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId != null ? "Edit former employee" : "Add former employee"}
            </DialogTitle>
            <DialogDescription>
              Manual record for someone who has left the organization.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="fe-name">Employee name</Label>
              <Input
                id="fe-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fe-email">Email (optional)</Label>
              <Input
                id="fe-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fe-department">Department</Label>
              <Input
                id="fe-department"
                value={form.department}
                onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fe-position">Position</Label>
              <Input
                id="fe-position"
                value={form.position}
                onChange={(e) => setForm((p) => ({ ...p, position: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fe-joining">Joining date</Label>
              <Input
                id="fe-joining"
                type="date"
                value={form.joiningDate}
                onChange={(e) => setForm((p) => ({ ...p, joiningDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fe-resign">Date of resignation</Label>
              <Input
                id="fe-resign"
                type="date"
                value={form.resignationDate}
                onChange={(e) => setForm((p) => ({ ...p, resignationDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fe-last">Last working day</Label>
              <Input
                id="fe-last"
                type="date"
                value={form.lastWorkingDay}
                onChange={(e) => setForm((p) => ({ ...p, lastWorkingDay: e.target.value }))}
              />
            </div>
            <div className="space-y-3 md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={form.servedNoticePeriod}
                  onCheckedChange={(checked) =>
                    setForm((p) => ({
                      ...p,
                      servedNoticePeriod: checked === true,
                      noticePeriodDays: checked === true ? p.noticePeriodDays : "",
                    }))
                  }
                />
                <span className="text-sm text-gray-700">Served notice period</span>
              </label>
              {form.servedNoticePeriod ? (
                <div className="max-w-xs space-y-2">
                  <Label htmlFor="fe-notice-days">Notice days served</Label>
                  <Input
                    id="fe-notice-days"
                    type="number"
                    min={0}
                    max={365}
                    value={form.noticePeriodDays}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, noticePeriodDays: e.target.value }))
                    }
                    placeholder="e.g. 30"
                  />
                </div>
              ) : null}
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="fe-reason">Reason for leaving</Label>
              <textarea
                id="fe-reason"
                value={form.reasonForLeaving}
                onChange={(e) =>
                  setForm((p) => ({ ...p, reasonForLeaving: e.target.value }))
                }
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                placeholder="Resignation, better offer, relocation…"
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="fe-notes">Additional notes (optional)</Label>
              <textarea
                id="fe-notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />
            </div>

            <div className="md:col-span-2 rounded-xl border border-gray-200 bg-white p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[#1F2937]">Documents</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Upload relieving letters, exit forms, PAN/Aadhaar scans, PDFs, or other files.
                  You can select multiple files at once.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-gray-500 mb-1">
                    Document label (optional)
                  </label>
                  <input
                    type="text"
                    value={docLabel}
                    onChange={(e) => setDocLabel(e.target.value)}
                    placeholder="e.g. Relieving letter, Exit form"
                    className={inputClass}
                    maxLength={120}
                  />
                </div>
                <label className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] cursor-pointer disabled:opacity-60">
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
                  {uploading
                    ? "Uploading…"
                    : editingId != null
                      ? "Upload files"
                      : "Select files"}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={uploading || saving}
                    onChange={(e) => {
                      if (editingId != null) {
                        void handleUploadExisting(e.target.files);
                      } else {
                        queuePendingFiles(e.target.files);
                      }
                      e.target.value = "";
                    }}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf"
                  />
                </label>
              </div>

              {editingId != null ? (
                docsLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 size={20} className="animate-spin text-gray-400" />
                  </div>
                ) : documents.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No documents uploaded yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                    {documents.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50/80"
                      >
                        <Paperclip size={16} className="text-gray-400 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[#1F2937] truncate font-medium">
                            {doc.label || doc.fileName}
                          </div>
                          <div className="text-xs text-gray-400 truncate">
                            {doc.label ? `${doc.fileName} · ` : ""}
                            {formatDocSize(doc.fileSize)}
                            {doc.createdAt
                              ? ` · ${formatWorkZoneDateTime(doc.createdAt, {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}`
                              : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDownload(doc.id, doc.fileName, doc.mimeType)
                          }
                          disabled={downloadingId === doc.id}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500"
                          title="Download"
                        >
                          {downloadingId === doc.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Download size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const confirmed = window.confirm(
                              `Delete "${doc.label || doc.fileName}"?`,
                            );
                            if (!confirmed) return;
                            deleteDocMutation.mutate({ id: doc.id });
                          }}
                          disabled={deleteDocMutation.isPending}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : pendingFiles.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">
                  No files selected yet. Selected files will upload when you add the record.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {pendingFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50/80"
                    >
                      <Paperclip size={16} className="text-gray-400 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[#1F2937] truncate font-medium">
                          {docLabel.trim() || file.name}
                        </div>
                        <div className="text-xs text-gray-400 truncate">
                          {docLabel.trim() ? `${file.name} · ` : ""}
                          {formatDocSize(file.size)}
                          <span> · pending upload</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingFiles((prev) => prev.filter((_, i) => i !== index))
                        }
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {formError ? <p className="text-sm text-red-500 mt-3">{formError}</p> : null}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={busy}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {editingId != null ? "Save changes" : "Add record"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
