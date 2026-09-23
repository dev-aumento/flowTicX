import { useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { RoleBadge } from "@/components/shared/StatusBadge";
import { PersonalInformationPanel } from "@/components/settings/PersonalInformationPanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Building2 } from "lucide-react";
import { formatWorkZoneDateTime } from "@/lib/timezone";
import { departmentSelectOptions } from "@/lib/department-options";

type EmployeeDetailDialogProps = {
  userId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit?: boolean;
};

function formatDateTime(value: Date | string | null | undefined) {
  return formatWorkZoneDateTime(value);
}

function DetailItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="flex items-center gap-1.5 text-sm text-[#1F2937] min-w-0">
        {icon}
        <span className="truncate capitalize">{value || "—"}</span>
      </div>
    </div>
  );
}

export function EmployeeDetailDialog({
  userId,
  open,
  onOpenChange,
  canEdit = false,
}: EmployeeDetailDialogProps) {
  const utils = trpc.useUtils();
  const { data: employee, isLoading } = trpc.user.getById.useQuery(
    { id: userId! },
    { enabled: open && userId != null },
  );

  const [editRole, setEditRole] = useState<"admin" | "manager" | "employee" | "hr" | "client" | "finance">("employee");
  const [editDepartment, setEditDepartment] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    setEditRole(employee.role as "admin" | "manager" | "employee" | "hr" | "client" | "finance");
    setEditDepartment(employee.department ?? "");
    setSaveError(null);
  }, [employee]);

  const updateRoleMutation = trpc.user.updateRole.useMutation();
  const updateMutation = trpc.user.update.useMutation();

  const dirty =
    !!employee &&
    (editRole !== employee.role ||
      (editDepartment.trim() || null) !== (employee.department ?? null));

  async function handleSave() {
    if (!employee || !userId) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      if (editRole !== employee.role) {
        await updateRoleMutation.mutateAsync({ id: userId, role: editRole });
      }
      const nextDepartment = editDepartment.trim() || null;
      if (nextDepartment !== (employee.department ?? null)) {
        await updateMutation.mutateAsync({ id: userId, department: nextDepartment });
      }
      await Promise.all([
        utils.user.list.invalidate(),
        utils.user.getById.invalidate({ id: userId }),
      ]);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save changes.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Employee details</DialogTitle>
          <DialogDescription>
            {canEdit
              ? "View and update profile, department, role, and personal information."
              : "Profile and activity overview for this employee."}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !employee ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-5 pt-1">
            <div className="flex items-center gap-4">
              <UserAvatar name={employee.name} avatar={employee.avatar} size={64} />
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-[#1F2937] truncate capitalize">
                  {employee.name || "Unknown"}
                </h3>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <RoleBadge role={employee.role as "admin" | "manager" | "employee" | "hr" | "client" | "finance"} />
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                      employee.status === "Active"
                        ? "bg-emerald-50 text-emerald-600"
                        : employee.status === "Inactive"
                          ? "bg-gray-100 text-gray-500"
                          : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    {employee.status.toLowerCase()}
                  </span>
                </div>
              </div>
            </div>

            {canEdit ? (
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">
                      Department
                    </label>
                    <select
                      value={editDepartment}
                      onChange={(e) => setEditDepartment(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    >
                      <option value="">No department</option>
                      {departmentSelectOptions(employee.department, "all").map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">
                      Role
                    </label>
                    <select
                      value={editRole}
                      onChange={(e) => {
                        const next = e.target.value as
                          | "admin"
                          | "manager"
                          | "employee"
                          | "hr"
                          | "client"
                          | "finance";
                        setEditRole(next);
                        if (next === "finance" && !editDepartment.trim()) {
                          setEditDepartment("Finance");
                        }
                      }}
                      className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="employee">Employee</option>
                      <option value="hr">HR</option>
                      <option value="client">Client</option>
                      <option value="finance">Account Manager</option>
                    </select>
                  </div>
                </div>
                {saveError ? <p className="text-sm text-red-500">{saveError}</p> : null}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!dirty || isSaving}
                    className="bg-[#2563EB] hover:bg-[#1D4ED8] gap-2"
                  >
                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                    Save department & role
                  </Button>
                </div>
              </div>
            ) : null}

            <PersonalInformationPanel
              userId={userId!}
              onError={setSaveError}
              onSaved={() => {
                if (userId != null) {
                  void utils.user.getById.invalidate({ id: userId });
                  void utils.user.list.invalidate();
                }
              }}
            />

            {!canEdit ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailItem
                  label="Department"
                  value={employee.department}
                  icon={<Building2 size={14} className="text-gray-400 shrink-0" />}
                />
                <DetailItem label="Last sign in" value={formatDateTime(employee.lastSignInAt)} />
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
