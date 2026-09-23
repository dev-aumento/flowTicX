import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { motion } from "framer-motion";
import {
  CalendarCheck2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { canManageAttendance, isAttendanceTrackableUser } from "@/lib/leave-policy";
import { workZoneDateParts } from "@/lib/timezone";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { MonthAttendanceCard } from "@/components/dashboard/MonthAttendanceCard";
import { cn } from "@/lib/utils";

function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function formatLeaveMetric(value: number) {
  if (!value || value <= 0) return "None";
  if (value === 0.5) return "0.5 Day";
  if (value === 1) return "1 Day";
  return `${value} Days`;
}

export default function AttendanceManagement() {
  const { user } = useAuth();
  const allowed = canManageAttendance(user);
  const nowParts = workZoneDateParts(new Date());
  const [year, setYear] = useState(nowParts.year);
  const [month, setMonth] = useState(nowParts.month);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const { data, isLoading } = trpc.timeEntry.getTeamMonthAttendance.useQuery(
    { year, month },
    { enabled: allowed },
  );

  const filtered = useMemo(() => {
    const rows = (data ?? []).filter((row) => isAttendanceTrackableUser(row));
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        (row.email ?? "").toLowerCase().includes(q) ||
        (row.department ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const selected = filtered.find((r) => r.userId === selectedUserId) ?? filtered[0] ?? null;

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  const goPrev = () => {
    const next = shiftMonth(year, month, -1);
    setYear(next.year);
    setMonth(next.month);
  };
  const goNext = () => {
    const next = shiftMonth(year, month, 1);
    setYear(next.year);
    setMonth(next.month);
  };

  const monthLabel =
    selected?.attendance.monthLabel ??
    data?.[0]?.attendance.monthLabel ??
    `${month}/${year}`;

  const leaveBreakdown = selected?.attendance.leaveBreakdown;

  function leaveTotalFor(row: (typeof filtered)[number]) {
    return (
      (row.attendance.leaveBreakdown?.paidDays ?? 0) +
      (row.attendance.leaveBreakdown?.sickDays ?? 0) +
      (row.attendance.leaveBreakdown?.unpaidDays ?? 0)
    );
  }

  function selectEmployee(userId: number) {
    setSelectedUserId(userId);
    setMobileListOpen(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-0 flex-col gap-4 xl:h-[calc(100dvh-6.5rem)]"
    >
      <div className="shrink-0">
        <h1 className="text-xl sm:text-2xl font-bold text-[#1F2937] flex items-center gap-2">
          <CalendarCheck2 size={22} className="text-[#2563EB]" />
          Attendance
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Month-wise attendance for employees, HR, and project managers (Mon–Fri working days)
        </p>
      </div>

      <div className="sticky top-16 z-20 -mx-1 flex shrink-0 flex-col gap-3 bg-[#F8F9FA] px-1 py-1 sm:flex-row sm:items-center dark:bg-[#0d1117] xl:static xl:z-auto xl:mx-0 xl:bg-transparent xl:px-0 xl:py-0 xl:dark:bg-transparent">
        <div className="relative min-w-0 w-full sm:max-w-md sm:flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={goPrev}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-0 flex-1 text-center text-sm font-semibold text-[#1F2937] sm:min-w-[148px] sm:flex-none">
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={goNext}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-16 text-gray-500 gap-2">
          <Loader2 size={18} className="animate-spin" />
          Loading attendance...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          No employees found for this month.
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-5 xl:flex-1 xl:grid-cols-[320px_minmax(0,1fr)] xl:overflow-hidden">
          <div className="xl:hidden">
            <button
              type="button"
              onClick={() => setMobileListOpen((open) => !open)}
              aria-expanded={mobileListOpen}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left"
            >
              {selected ? (
                <>
                  <UserAvatar name={selected.name} avatar={selected.avatar} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[#1F2937]">
                      {selected.name}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {selected.department || selected.role}
                      {" · "}
                      {selected.attendance.attendanceDays}/{selected.attendance.workingDays} days
                    </div>
                  </div>
                </>
              ) : (
                <span className="flex-1 text-sm text-gray-500">Select employee</span>
              )}
              <ChevronDown
                size={18}
                className={cn(
                  "shrink-0 text-gray-400 transition-transform",
                  mobileListOpen && "rotate-180",
                )}
              />
            </button>
            {mobileListOpen ? (
              <div className="mt-2 max-h-64 overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-gray-200 bg-white">
                {filtered.map((row) => {
                  const active = (selected?.userId ?? null) === row.userId;
                  const leaveTotal = leaveTotalFor(row);
                  return (
                    <button
                      key={row.userId}
                      type="button"
                      onClick={() => selectEmployee(row.userId)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 transition-colors",
                        active ? "bg-blue-50" : "hover:bg-gray-50",
                      )}
                    >
                      <UserAvatar name={row.name} avatar={row.avatar} size={36} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#1F2937]">
                          {row.name}
                        </div>
                        <div className="truncate text-xs text-gray-500">
                          {row.department || row.role}
                          {" · "}
                          {row.attendance.attendanceDays}/{row.attendance.workingDays} days
                          {leaveTotal > 0 ? ` · ${leaveTotal} leave` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="hidden min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-gray-200 bg-white xl:block">
            {filtered.map((row) => {
              const active = (selected?.userId ?? null) === row.userId;
              const leaveTotal = leaveTotalFor(row);
              return (
                <button
                  key={row.userId}
                  type="button"
                  onClick={() => selectEmployee(row.userId)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 transition-colors",
                    active ? "bg-blue-50" : "hover:bg-gray-50",
                  )}
                >
                  <UserAvatar name={row.name} avatar={row.avatar} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#1F2937]">
                      {row.name}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {row.department || row.role}
                      {" · "}
                      {row.attendance.attendanceDays}/{row.attendance.workingDays} days
                      {leaveTotal > 0 ? ` · ${leaveTotal} leave` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="min-h-0 space-y-4 overflow-x-hidden pb-2 xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
            {selected ? (
              <>
                <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
                  <UserAvatar name={selected.name} avatar={selected.avatar} size={48} />
                  <div>
                    <div className="font-semibold text-[#1F2937]">{selected.name}</div>
                    <div className="text-sm text-gray-500">
                      {[selected.department, selected.email].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
                <MonthAttendanceCard
                  data={selected.attendance}
                  employeeName={selected.name}
                />
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-left font-medium px-4 py-2.5">Metric</th>
                        <th className="text-right font-medium px-4 py-2.5">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="px-4 py-2.5">Working days (excl Sat–Sun & holidays)</td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {selected.attendance.workingDays}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5">Attendance</td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {selected.attendance.attendanceDays} Days
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5">Late</td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {selected.attendance.lateDays} Days
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5">
                          Paid leave
                          <span className="block text-xs text-gray-400 font-normal">
                            Approved only
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {formatLeaveMetric(leaveBreakdown?.paidDays ?? 0)}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5">
                          Sick leave
                          <span className="block text-xs text-gray-400 font-normal">
                            Approved only
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {formatLeaveMetric(leaveBreakdown?.sickDays ?? 0)}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5">
                          Unpaid leave
                          <span className="block text-xs text-gray-400 font-normal">
                            Approved only
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {formatLeaveMetric(leaveBreakdown?.unpaidDays ?? 0)}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5">Worked hours (month total)</td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {selected.attendance.workedHoursLabel}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </motion.div>
  );
}
