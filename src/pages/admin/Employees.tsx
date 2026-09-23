import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { RoleBadge } from "@/components/shared/StatusBadge";
import {
  Users, Search, X, Loader2, Shield, UserCheck,
  UserX, UserPlus, Link2, Copy, KeyRound, Trash2, GripVertical,
} from "lucide-react";
import { PERMISSION_GROUPS } from "@contracts/permissions";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatWorkZoneDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/lib/permissions";
import { isClientPortalUser } from "@/lib/client-portal";
import { EmployeeDetailDialog } from "@/components/admin/EmployeeDetailDialog";
import { InviteUserDialog } from "@/components/admin/InviteUserDialog";
import { departmentSelectOptions } from "@/lib/department-options";
import { FilterSelect } from "@/components/shared/FilterSelect";
import {
  isInProbationPeriod,
  resolveEmploymentType,
  paidLeaveLockPeriodLabel,
  canManageNoticePeriod,
} from "@/lib/leave-policy";

const EMPLOYEE_ROW_GRID =
  "grid grid-cols-[32px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(8.75rem,1fr)_minmax(5.5rem,0.9fr)_140px] gap-3 px-5 items-center";

type EmployeeRow = {
  id: number;
  name: string | null;
  email: string | null;
  avatar?: string | null;
  department?: string | null;
  role: string;
  status: string;
  permissions?: string[];
  dateOfJoining?: Date | string | null;
  employmentType?: string | null;
  position?: string | null;
  onNoticePeriod?: boolean | null;
};

export default function AdminEmployees({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { user } = useAuth();
  const clientWorkspace = isClientPortalUser(user);
  const canManageEmployees = hasPermission(user, "employees.manage");
  const canManagePermissions = hasPermission(user, "permissions.manage");
  const canViewNoticePeriod = canManageNoticePeriod(user);
  const canOpenEmployeeDetail = canManageEmployees || canViewNoticePeriod;
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editingUser, setEditingUser] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<"admin" | "manager" | "employee" | "hr" | "client" | "finance">("employee");
  const [editDepartment, setEditDepartment] = useState("");
  const [savingEditId, setSavingEditId] = useState<number | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [detailUserId, setDetailUserId] = useState<number | null>(null);
  const [accessUser, setAccessUser] = useState<{
    id: number;
    name: string | null;
    role?: string | null;
    permissions: string[];
  } | null>(null);
  const [accessPermissions, setAccessPermissions] = useState<string[]>([]);
  const [orderedUsers, setOrderedUsers] = useState<EmployeeRow[]>([]);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  const { data, isLoading } = trpc.user.list.useQuery({
    search: search || undefined,
    role: roleFilter || undefined,
    status: statusFilter || undefined,
    limit: 500,
  });

  const { data: pendingInvites, refetch: refetchInvites } = trpc.invite.list.useQuery(undefined, {
    retry: false,
    enabled: canManageEmployees,
  });

  const utils = trpc.useUtils();

  useEffect(() => {
    setOrderedUsers((data?.users ?? []) as EmployeeRow[]);
  }, [data?.users]);

  const canReorder = !search && !roleFilter && !statusFilter;

  const reorderMutation = trpc.user.reorder.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
    },
    onError: () => {
      setOrderedUsers((data?.users ?? []) as EmployeeRow[]);
    },
  });

  const updateRoleMutation = trpc.user.updateRole.useMutation();

  const updateStatusMutation = trpc.user.update.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
    },
  });

  const updateEmployeeMutation = trpc.user.update.useMutation();

  const updatePermissionsMutation = trpc.user.update.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      setAccessUser(null);
    },
  });

  async function saveEmployeeEdits(target: EmployeeRow) {
    setSavingEditId(target.id);
    try {
      const nextDepartment = editDepartment.trim() || null;
      const departmentChanged = (target.department ?? null) !== nextDepartment;
      const roleChanged = target.role !== editRole;

      if (roleChanged) {
        await updateRoleMutation.mutateAsync({ id: target.id, role: editRole });
      }
      if (departmentChanged) {
        await updateEmployeeMutation.mutateAsync({
          id: target.id,
          department: nextDepartment,
        });
      }
      await utils.user.list.invalidate();
      setEditingUser(null);
    } finally {
      setSavingEditId(null);
    }
  }

  function startEditing(target: EmployeeRow) {
    if (editingUser === target.id) {
      setEditingUser(null);
      return;
    }
    setEditingUser(target.id);
    setEditRole(target.role as "admin" | "manager" | "employee" | "hr" | "client" | "finance");
    setEditDepartment(target.department ?? "");
  }

  const revokeInviteMutation = trpc.invite.revoke.useMutation({
    onSuccess: () => {
      refetchInvites();
    },
  });

  const employeeInvites =
    pendingInvites?.invites.filter((invite) => invite.inviteKind !== "client") ?? [];

  const hasFilters = search || roleFilter || statusFilter;

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("");
    setStatusFilter("");
  };

  function openAccessDialog(u: {
    id: number;
    name: string | null;
    role?: string | null;
    permissions?: string[];
  }) {
    setAccessUser({
      id: u.id,
      name: u.name,
      role: u.role,
      permissions: u.permissions ?? [],
    });
    setAccessPermissions(u.permissions ?? []);
  }

  function toggleAccessPermission(key: string) {
    setAccessPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  }

  function handleDragStart(e: React.DragEvent, id: number) {
    if (!canReorder) {
      e.preventDefault();
      return;
    }
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id));
  }

  function handleDragOver(e: React.DragEvent, id: number) {
    if (!canReorder || draggedId == null || draggedId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(id);
  }

  function handleDrop(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    if (!canReorder || draggedId == null || draggedId === targetId) {
      setDraggedId(null);
      setDropTargetId(null);
      return;
    }

    const fromIndex = orderedUsers.findIndex((u) => u.id === draggedId);
    const toIndex = orderedUsers.findIndex((u) => u.id === targetId);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggedId(null);
      setDropTargetId(null);
      return;
    }

    const next = [...orderedUsers];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setOrderedUsers(next);
    setDraggedId(null);
    setDropTargetId(null);
    reorderMutation.mutate({ orderedIds: next.map((u) => u.id) });
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDropTargetId(null);
  }

  const totalLabel = useMemo(
    () => data?.total ?? orderedUsers.length,
    [data?.total, orderedUsers.length],
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        {!embedded ? (
          <div>
            <h1 className="text-2xl font-bold text-[#1F2937]">
              {clientWorkspace ? "Team" : "Employees"}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {clientWorkspace
                ? `${totalLabel} teammate${totalLabel === 1 ? "" : "s"} · invite people to join as employees you can assign`
                : `${totalLabel} total employees${
                    canReorder ? " · drag rows to reorder" : " · clear filters to reorder"
                  }`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            {totalLabel} total employees
          </p>
        )}
        {canManageEmployees ? (
          <Button
            onClick={() => setInviteOpen(true)}
            className={
              clientWorkspace
                ? "bg-[#F06A6A] hover:bg-[#E45C5C] gap-2 shrink-0"
                : "bg-[#2563EB] hover:bg-[#1D4ED8] gap-2 shrink-0"
            }
          >
            <UserPlus size={16} />
            Invite {clientWorkspace ? "Teammate" : "Employee"}
          </Button>
        ) : null}
      </div>

      {employeeInvites.length > 0 ? (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Link2 size={16} className="text-[#2563EB]" />
            <h2 className="text-sm font-semibold text-[#1F2937]">
              Pending invite links ({employeeInvites.length})
            </h2>
          </div>
          <div className="space-y-2">
            {employeeInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between gap-3 bg-white rounded-lg px-3 py-2 border border-blue-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 truncate">{invite.url}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {invite.email ? `${invite.email} · ` : ""}
                    Expires {formatWorkZoneDate(invite.expiresAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(invite.url);
                    }}
                    className="h-8 px-2.5 text-xs text-[#2563EB] hover:bg-blue-50 rounded-lg flex items-center gap-1"
                  >
                    <Copy size={12} /> Copy
                  </button>
                  <button
                    onClick={() => revokeInviteMutation.mutate({ id: invite.id })}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                    title="Revoke invite"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div
        className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 flex-wrap"
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="w-full h-9 pl-9 pr-4 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>
        <div className="flex gap-2">
          <FilterSelect
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: "", label: "All Roles" },
              { value: "admin", label: "Admin" },
              { value: "manager", label: "Manager" },
              { value: "employee", label: "Employee" },
              { value: "hr", label: "HR" },
              { value: "finance", label: "Account Manager" },
            ]}
            aria-label="Filter by role"
            triggerClassName="h-9 bg-gray-50"
          />
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "", label: "All Status" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "suspended", label: "Suspended" },
            ]}
            aria-label="Filter by status"
            triggerClassName="h-9 bg-gray-50"
          />
          {hasFilters && (
            <button onClick={clearFilters} className="h-9 px-3 text-sm text-gray-500 hover:text-[#2563EB] flex items-center gap-1 shrink-0">
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <div className="min-w-[880px]">
          <div
            className={cn(
              EMPLOYEE_ROW_GRID,
              "py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider",
            )}
          >
            <span aria-hidden className="block w-4" />
            <span className="min-w-0 truncate">Employee</span>
            <span className="min-w-0 truncate text-center">Department</span>
            <span className="min-w-0 truncate text-center">Role</span>
            <span className="min-w-0 truncate text-center">Status</span>
            <span className="min-w-0 truncate">Actions</span>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          )}

          <div>
            {orderedUsers.map((u) => (
              <div
                key={u.id}
                draggable={canReorder}
                onDragStart={(e) => handleDragStart(e, u.id)}
                onDragOver={(e) => handleDragOver(e, u.id)}
                onDrop={(e) => handleDrop(e, u.id)}
                onDragEnd={handleDragEnd}
                className={cn(
                  EMPLOYEE_ROW_GRID,
                  "py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors",
                  canReorder && "cursor-grab active:cursor-grabbing",
                  draggedId === u.id && "opacity-50 bg-blue-50",
                  dropTargetId === u.id && draggedId !== u.id && "border-t-2 border-t-[#2563EB]",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center text-gray-300",
                    canReorder ? "text-gray-400" : "opacity-40",
                  )}
                  title={canReorder ? "Drag to reorder" : "Clear filters to reorder"}
                  aria-hidden
                >
                  <GripVertical size={16} />
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    disabled={!canOpenEmployeeDetail}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canOpenEmployeeDetail) return;
                      setDetailUserId(u.id);
                    }}
                    className={cn(
                      "flex items-center gap-3 min-w-0 text-left rounded-lg -ml-1 pl-1 pr-2 py-1 transition-colors",
                      canOpenEmployeeDetail
                        ? "hover:bg-gray-100 cursor-pointer"
                        : "cursor-default",
                    )}
                    title={canOpenEmployeeDetail ? "View employee details" : undefined}
                  >
                    <UserAvatar name={u.name} avatar={u.avatar} size={32} />
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "text-sm font-medium truncate capitalize",
                          canOpenEmployeeDetail ? "text-[#2563EB]" : "text-[#1F2937]",
                        )}
                      >
                        {u.name || "Unknown"}
                      </div>
                      <div className="text-xs text-gray-400 truncate">{u.email || "No email"}</div>
                    </div>
                  </button>
                </div>
                <div className="min-w-0 flex justify-center">
                  {editingUser === u.id && canManageEmployees ? (
                    <select
                      value={editDepartment}
                      onChange={(e) => setEditDepartment(e.target.value)}
                      className="h-8 w-full max-w-full px-2 border border-gray-200 rounded-lg text-xs bg-white"
                      aria-label="Edit department"
                    >
                      <option value="">No department</option>
                      {departmentSelectOptions(u.department, "all").map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm text-gray-600 truncate text-center max-w-full">
                      {u.department || "—"}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex justify-center">
                  {editingUser === u.id && canManageEmployees && !clientWorkspace ? (
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
                      className="h-8 w-full max-w-[11rem] px-2 border border-gray-200 rounded-lg text-xs bg-white"
                      aria-label="Edit role"
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="employee">Employee</option>
                      <option value="hr">HR</option>
                      <option value="client">Client</option>
                      <option value="finance">Account Manager</option>
                    </select>
                  ) : (
                    <RoleBadge role={u.role as "admin" | "manager" | "employee" | "hr" | "client" | "finance"} />
                  )}
                </div>
                <div className="min-w-0 flex flex-wrap items-center justify-center gap-1.5">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize whitespace-nowrap ${
                      u.status === "active"
                        ? "bg-emerald-50 text-emerald-600"
                        : u.status === "inactive"
                        ? "bg-gray-100 text-gray-500"
                        : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    {u.status}
                  </span>
                  {canViewNoticePeriod &&
                  isInProbationPeriod(
                    u.dateOfJoining,
                    new Date(),
                    resolveEmploymentType(u),
                  ) ? (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700"
                      title={`No paid leave during ${paidLeaveLockPeriodLabel(resolveEmploymentType(u))} (starts next month if joined on/after the 20th)`}
                    >
                      {resolveEmploymentType(u) === "intern"
                        ? "Internship / probation"
                        : "In probation"}
                    </span>
                  ) : null}
                  {canViewNoticePeriod && u.onNoticePeriod ? (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700"
                      title="No paid leave for the current month while on notice period"
                    >
                      On notice period
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  {editingUser === u.id && canManageEmployees ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void saveEmployeeEdits(u)}
                        disabled={savingEditId === u.id}
                        className="h-7 px-2.5 bg-[#2563EB] text-white rounded-lg text-xs font-medium hover:bg-[#1D4ED8] disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {savingEditId === u.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : null}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingUser(null)}
                        disabled={savingEditId === u.id}
                        className="h-7 px-2 text-xs text-gray-500 hover:text-gray-800"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {(u.role !== "admin") && canManagePermissions && (
                        <button
                          onClick={() => openAccessDialog(u)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors"
                          title="Manage access"
                        >
                          <KeyRound size={14} className="text-[#2563EB]" />
                        </button>
                      )}
                      {canManageEmployees ? (
                        <button
                          onClick={() => startEditing(u)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors"
                          title="Edit department & role"
                        >
                          <Shield size={14} className="text-gray-500" />
                        </button>
                      ) : null}
                      {canManageEmployees ? (
                        <button
                          onClick={() => {
                            const nextStatus = u.status === "active" ? "inactive" : "active";
                            if (nextStatus === "inactive") {
                              const confirmed = window.confirm(
                                "Are you sure you want to deactivate this user?",
                              );
                              if (!confirmed) return;
                            }
                            updateStatusMutation.mutate({
                              id: u.id,
                              status: nextStatus,
                            });
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors"
                          title={u.status === "active" ? "Deactivate" : "Activate"}
                        >
                          {u.status === "active" ? (
                            <UserX size={14} className="text-blue-400" />
                          ) : (
                            <UserCheck size={14} className="text-emerald-500" />
                          )}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {orderedUsers.length === 0 && !isLoading && (
            <div className="py-12 text-center">
              <Users size={36} className="mx-auto text-gray-200 mb-2" />
              <p className="text-gray-500 text-sm">No employees found</p>
            </div>
          )}
        </div>
      </div>


      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        kind="employee"
        teammateLabel={clientWorkspace}
      />

      {/* Employee access dialog */}
      <Dialog open={!!accessUser} onOpenChange={(open) => !open && setAccessUser(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0">
          <div className="shrink-0 border-b border-gray-100 px-6 pt-6 pb-4 pr-12">
            <DialogHeader>
              <DialogTitle>Manage access</DialogTitle>
              <DialogDescription>
                Choose what <strong>{accessUser?.name || "this employee"}</strong> can access in the employee and project manager portal.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-5">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.id}>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {group.label}
                  </h3>
                  <div className="space-y-2">
                    {group.permissions
                      .filter(
                        (perm) =>
                          String(accessUser?.role ?? "").toLowerCase() !== "client" ||
                          perm.key !== "invoices.manage",
                      )
                      .map((perm) => (
                      <label
                        key={perm.key}
                        className="flex items-start gap-3 cursor-pointer"
                      >
                        <Checkbox
                          checked={accessPermissions.includes(perm.key)}
                          onCheckedChange={() => toggleAccessPermission(perm.key)}
                          className="mt-0.5"
                        />
                        <span className="text-sm text-gray-700">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-gray-100 bg-background px-6 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setAccessUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!accessUser) return;
                updatePermissionsMutation.mutate({
                  id: accessUser.id,
                  permissions:
                    String(accessUser.role ?? "").toLowerCase() === "client"
                      ? accessPermissions.filter((key) => key !== "invoices.manage")
                      : accessPermissions,
                });
              }}
              disabled={updatePermissionsMutation.isPending}
              className="bg-[#2563EB] hover:bg-[#1D4ED8]"
            >
              {updatePermissionsMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "Save access"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canOpenEmployeeDetail ? (
        <EmployeeDetailDialog
          userId={detailUserId}
          open={detailUserId != null}
          onOpenChange={(open) => {
            if (!open) setDetailUserId(null);
          }}
          canEdit={canManageEmployees}
        />
      ) : null}
    </motion.div>
  );
}
