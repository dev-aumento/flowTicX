import { useEffect, useMemo, useState, type ElementType } from "react";
import { useSearchParams } from "react-router";
import { motion } from "framer-motion";
import {
  Building2,
  ChevronRight,
  Loader2,
  Search,
  UserRound,
  Users,
  UserX,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/lib/permissions";
import { canManageNoticePeriod } from "@/lib/leave-policy";
import { DEPARTMENT_OPTIONS } from "@/lib/department-options";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { RoleBadge } from "@/components/shared/StatusBadge";
import { EmployeeDetailDialog } from "@/components/admin/EmployeeDetailDialog";
import { cn } from "@/lib/utils";

const UNASSIGNED_KEY = "__unassigned__";
const UNASSIGNED_LABEL = "Unassigned";
const DEPT_COLORS = ["#2563EB", "#0EA5E9", "#10B981", "#F59E0B", "#8B5CF6", "#F43F5E"];

type StaffMember = {
  id: number;
  name: string | null;
  email: string | null;
  avatar?: string | null;
  department?: string | null;
  position?: string | null;
  role: string;
  status: string;
  headOfDepartmentUserIds?: number[];
};

function isActiveStatus(status: string | null | undefined) {
  return String(status ?? "").toLowerCase() === "active";
}

function departmentKey(department?: string | null) {
  const trimmed = (department ?? "").trim();
  return trimmed ? trimmed.toLowerCase().replace(/\s+/g, " ") : UNASSIGNED_KEY;
}

function departmentLabel(department?: string | null) {
  const trimmed = (department ?? "").trim();
  if (!trimmed) return UNASSIGNED_LABEL;
  const known = DEPARTMENT_OPTIONS.find(
    (option) => option.toLowerCase() === trimmed.toLowerCase(),
  );
  return known ?? trimmed;
}

function StatusPill({ status }: { status: string }) {
  const active = isActiveStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize",
        active
          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
          : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400",
      )}
    >
      {status || "unknown"}
    </span>
  );
}

export default function AdminDepartments() {
  const { user } = useAuth();
  const canManageEmployees = hasPermission(user, "employees.manage");
  const canOpenEmployeeDetail = canManageEmployees || canManageNoticePeriod(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [detailUserId, setDetailUserId] = useState<number | null>(null);
  const selectedKey = searchParams.get("dept");

  const { data, isLoading } = trpc.user.list.useQuery({ limit: 500 });

  const staff = useMemo(
    () =>
      ((data?.users ?? []) as StaffMember[]).filter(
        (member) => String(member.role ?? "").toLowerCase() !== "client",
      ),
    [data?.users],
  );

  const byId = useMemo(() => {
    const map = new Map<number, StaffMember>();
    for (const member of staff) map.set(member.id, member);
    return map;
  }, [staff]);

  const departments = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        name: string;
        members: StaffMember[];
      }
    >();

    for (const member of staff) {
      const key = departmentKey(member.department);
      const existing = groups.get(key);
      if (existing) {
        existing.members.push(member);
        continue;
      }
      groups.set(key, {
        key,
        name: departmentLabel(member.department),
        members: [member],
      });
    }

    return [...groups.values()]
      .map((group) => {
        const activeMembers = group.members.filter((member) => isActiveStatus(member.status));
        const headCounts = new Map<number, number>();
        for (const member of group.members) {
          for (const headId of member.headOfDepartmentUserIds ?? []) {
            headCounts.set(headId, (headCounts.get(headId) ?? 0) + 1);
          }
        }
        const heads = [...headCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => byId.get(id))
          .filter((head): head is StaffMember => Boolean(head));
        const fallbackLeads = group.members.filter((member) => {
          const role = String(member.role ?? "").toLowerCase();
          return role === "manager" || role === "admin" || role === "hr";
        });

        return {
          ...group,
          activeCount: activeMembers.length,
          inactiveCount: group.members.length - activeMembers.length,
          heads: heads.length > 0 ? heads : fallbackLeads.slice(0, 3),
        };
      })
      .sort((a, b) => {
        if (a.key === UNASSIGNED_KEY) return 1;
        if (b.key === UNASSIGNED_KEY) return -1;
        if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
        return a.name.localeCompare(b.name);
      });
  }, [byId, staff]);

  const activeDepartments = useMemo(
    () => departments.filter((group) => group.key !== UNASSIGNED_KEY && group.activeCount > 0),
    [departments],
  );

  const query = search.trim().toLowerCase();
  const visibleDepartments = useMemo(() => {
    const source = departments.filter(
      (group) => group.key === UNASSIGNED_KEY || group.activeCount > 0 || group.members.length > 0,
    );
    if (!query) {
      return source.filter((group) => group.key !== UNASSIGNED_KEY || group.members.length > 0);
    }
    return source.filter((group) => {
      if (group.name.toLowerCase().includes(query)) return true;
      return group.members.some((member) => {
        const haystack = [member.name, member.email, member.position, member.role]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    });
  }, [departments, query]);

  const assignedActive = staff.filter(
    (member) => isActiveStatus(member.status) && departmentKey(member.department) !== UNASSIGNED_KEY,
  ).length;
  const unassignedActive = staff.filter(
    (member) => isActiveStatus(member.status) && departmentKey(member.department) === UNASSIGNED_KEY,
  ).length;

  useEffect(() => {
    if (visibleDepartments.length === 0) return;
    const exists = visibleDepartments.some((group) => group.key === selectedKey);
    if (exists) return;
    const next =
      visibleDepartments.find((group) => group.key !== UNASSIGNED_KEY) ?? visibleDepartments[0];
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        nextParams.set("dept", next.key);
        return nextParams;
      },
      { replace: true },
    );
  }, [selectedKey, setSearchParams, visibleDepartments]);

  const selected =
    visibleDepartments.find((group) => group.key === selectedKey) ?? visibleDepartments[0] ?? null;

  const selectedMembers = useMemo(() => {
    if (!selected) return [];
    const members = [...selected.members].sort((a, b) => {
      const activeDelta = Number(isActiveStatus(b.status)) - Number(isActiveStatus(a.status));
      if (activeDelta !== 0) return activeDelta;
      return (a.name || "").localeCompare(b.name || "");
    });
    if (!query) return members;
    const matched = members.filter((member) => {
      const haystack = [member.name, member.email, member.position, member.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query) || selected.name.toLowerCase().includes(query);
    });
    return matched.length > 0 ? matched : members;
  }, [query, selected]);

  function selectDepartment(key: string) {
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      nextParams.set("dept", key);
      return nextParams;
    });
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#1F2937] dark:text-white">Departments</h1>
        <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">
          Active departments and the people in each one
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title="Active departments"
          value={activeDepartments.length}
          sub="With at least one active person"
          icon={Building2}
          iconWrap="bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
        />
        <KpiCard
          title="People assigned"
          value={assignedActive}
          sub="Active staff in a department"
          icon={Users}
          iconWrap="bg-blue-50 text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]"
        />
        <KpiCard
          title="Unassigned"
          value={unassignedActive}
          sub="Active staff with no department"
          icon={UserX}
          iconWrap="bg-orange-50 text-orange-500 dark:bg-orange-500/15 dark:text-orange-400"
        />
        <KpiCard
          title="Total staff"
          value={staff.filter((member) => isActiveStatus(member.status)).length}
          sub="Active directory members"
          icon={UserRound}
          iconWrap="bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
        />
      </div>

      <div className="">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search departments or people..."
            className="w-full h-9 pl-9 pr-4 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 dark:bg-[#0d1117] dark:border-[#30363d] dark:text-white"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-400" />
        </div>
      ) : visibleDepartments.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-16 text-center text-sm text-gray-400 dark:bg-[#161b22] dark:border-[#30363d]">
          No departments to show yet. Assign a department on the Employees page.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-[#161b22] dark:border-[#30363d]">
            <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:border-[#30363d]">
              Departments
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {visibleDepartments.map((group, index) => {
                const active = selected?.key === group.key;
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => selectDepartment(group.key)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 last:border-b-0 transition-colors dark:border-[#30363d]",
                      active
                        ? "bg-blue-50 dark:bg-[#2563EB]/15"
                        : "hover:bg-gray-50 dark:hover:bg-white/[0.04]",
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: DEPT_COLORS[index % DEPT_COLORS.length] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-sm font-medium truncate",
                          active
                            ? "text-[#2563EB] dark:text-[#93C5FD]"
                            : "text-[#1F2937] dark:text-white",
                        )}
                      >
                        {group.name}
                      </span>
                      <span className="block text-xs text-gray-400">
                        {group.activeCount} active
                        {group.inactiveCount > 0 ? ` · ${group.inactiveCount} inactive` : ""}
                      </span>
                    </span>
                    <ChevronRight
                      size={14}
                      className={cn(
                        "shrink-0",
                        active ? "text-[#2563EB]" : "text-gray-300 dark:text-slate-600",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {selected ? (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-[#161b22] dark:border-[#30363d]">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-[#30363d]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-[#1F2937] dark:text-white">
                      {selected.name}
                    </h2>
                    <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">
                      {selected.activeCount} active
                      {selected.inactiveCount > 0
                        ? ` · ${selected.inactiveCount} inactive`
                        : ""}
                      {` · ${selected.members.length} total`}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                    Head of department
                  </p>
                  {selected.heads.length === 0 ? (
                    <p className="text-sm text-gray-400">No head assigned</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selected.heads.map((head) => (
                        <button
                          key={head.id}
                          type="button"
                          disabled={!canOpenEmployeeDetail}
                          onClick={() => {
                            if (!canOpenEmployeeDetail) return;
                            setDetailUserId(head.id);
                          }}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-left dark:border-[#30363d] dark:bg-[#0d1117]",
                            canOpenEmployeeDetail && "hover:bg-gray-100 dark:hover:bg-white/[0.04]",
                          )}
                        >
                          <UserAvatar name={head.name} avatar={head.avatar} size={24} />
                          <span className="text-sm font-medium text-[#1F2937] dark:text-white">
                            {head.name || "Unknown"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_100px] gap-3 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-[#30363d]">
                    <span>Employee</span>
                    <span>Position</span>
                    <span>Role</span>
                    <span>Status</span>
                  </div>
                  {selectedMembers.length === 0 ? (
                    <p className="px-5 py-10 text-sm text-center text-gray-400">
                      No people in this department
                    </p>
                  ) : (
                    selectedMembers.map((member) => (
                      <div
                        key={member.id}
                        className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_100px] gap-3 px-5 py-3 border-b border-gray-50 last:border-b-0 items-center dark:border-[#30363d]"
                      >
                        <button
                          type="button"
                          disabled={!canOpenEmployeeDetail}
                          onClick={() => {
                            if (!canOpenEmployeeDetail) return;
                            setDetailUserId(member.id);
                          }}
                          className={cn(
                            "flex items-center gap-3 min-w-0 text-left rounded-lg -ml-1 pl-1 pr-2 py-1",
                            canOpenEmployeeDetail
                              ? "hover:bg-gray-50 cursor-pointer dark:hover:bg-white/[0.04]"
                              : "cursor-default",
                          )}
                        >
                          <UserAvatar name={member.name} avatar={member.avatar} size={32} />
                          <span className="min-w-0">
                            <span
                              className={cn(
                                "block text-sm font-medium truncate capitalize",
                                canOpenEmployeeDetail
                                  ? "text-[#2563EB] dark:text-[#93C5FD]"
                                  : "text-[#1F2937] dark:text-white",
                              )}
                            >
                              {member.name || "Unknown"}
                            </span>
                            <span className="block text-xs text-gray-400 truncate">
                              {member.email || "No email"}
                            </span>
                          </span>
                        </button>
                        <div className="text-sm text-gray-600 truncate dark:text-slate-300">
                          {member.position || "—"}
                        </div>
                        <div>
                          <RoleBadge role={member.role} />
                        </div>
                        <div>
                          <StatusPill status={member.status} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <EmployeeDetailDialog
        userId={detailUserId}
        open={detailUserId != null}
        onOpenChange={(open) => {
          if (!open) setDetailUserId(null);
        }}
        canEdit={canManageEmployees}
      />
    </motion.div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  iconWrap,
}: {
  title: string;
  value: number;
  sub: string;
  icon: ElementType;
  iconWrap: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-[#161b22] dark:border-[#30363d]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-slate-400">{title}</div>
          <div className="text-2xl font-bold mt-1 text-[#1F2937] dark:text-white">{value}</div>
          <div className="text-[11px] mt-0.5 text-gray-400 dark:text-slate-500">{sub}</div>
        </div>
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", iconWrap)}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}
