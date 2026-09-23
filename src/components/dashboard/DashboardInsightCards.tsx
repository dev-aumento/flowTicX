import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, FolderKanban, Loader2, Megaphone, Umbrella } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { MonthAttendanceCard } from "@/components/dashboard/MonthAttendanceCard";
import type { MonthAttendanceSummary } from "@/lib/month-attendance";
import {
  formatWorkZoneDate,
  workZoneDateKey,
  workZoneDateParts,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";

function projectInitial(name: string) {
  return (name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function statusLabel(status: string) {
  if (status === "active") return "Active";
  if (status === "completed") return "Completed";
  if (status === "archived") return "Archived";
  return status;
}

function statusTone(status: string) {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "completed") return "bg-blue-50 text-blue-700";
  return "bg-gray-100 text-gray-600";
}

type DashboardInsightCardsProps = {
  attendance?: MonthAttendanceSummary | null;
  attendanceLoading?: boolean;
};

export function DashboardInsightCards({
  attendance,
  attendanceLoading,
}: DashboardInsightCardsProps) {
  const navigate = useNavigate();
  const todayKey = workZoneDateKey(new Date());
  const year = workZoneDateParts(new Date()).year;

  const { data: projectsData, isLoading: projectsLoading } =
    trpc.project.list.useQuery(
      { status: "active", joinedOnly: true },
      { staleTime: 60_000 },
    );
  const { data: balance, isLoading: balanceLoading } =
    trpc.leave.myBalance.useQuery({ year }, { staleTime: 60_000 });
  const { data: holidaysData, isLoading: holidaysLoading } =
    trpc.leave.listHolidays.useQuery({ year }, { staleTime: 60_000 });

  const projects = useMemo(
    () => (projectsData ?? []).slice(0, 3),
    [projectsData],
  );

  const leaveRows = useMemo(() => {
    const paid = balance?.paidRemaining ?? 0;
    const sick = balance?.sickRemaining ?? 0;
    const wfh = balance?.wfhRemaining ?? 0;
    return [
      { label: "Paid Leave (PL)", value: `${formatDays(paid)}` },
      { label: "Sick Leave (SL)", value: `${formatDays(sick)}` },
      { label: "Work From Home", value: `${formatDays(wfh)}` },
    ];
  }, [balance]);

  const announcements = useMemo(() => {
    const holidays = (holidaysData?.holidays ?? [])
      .filter((h) => h.date >= todayKey)
      .slice(0, 3)
      .map((h) => ({
        id: `holiday-${h.id ?? h.date}`,
        title: h.name,
        subtitle: formatWorkZoneDate(h.date, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      }));
    return holidays;
  }, [holidaysData, todayKey]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-stretch">
      <div className="min-w-0">
        <MonthAttendanceCard
          data={attendance}
          isLoading={attendanceLoading}
          compact
        />
      </div>

      {/* My Projects */}
      <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex flex-col min-h-0 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-[#1F2937] flex items-center gap-2 min-w-0">
            <FolderKanban size={16} className="text-[#2563EB] shrink-0" />
            <span className="truncate">My Projects</span>
          </h2>
          <button
            type="button"
            onClick={() => navigate("/projects")}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:text-[#1D4ED8] shrink-0"
          >
            View all
            <ArrowRight size={11} />
          </button>
        </div>
        {projectsLoading ? (
          <div className="flex flex-1 items-center justify-center py-6">
            <Loader2 className="animate-spin text-gray-400" size={18} />
          </div>
        ) : projects.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-500">No active projects</p>
        ) : (
          <ul className="space-y-1.5">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="flex w-full items-center gap-2 rounded-lg px-0.5 py-1 text-left hover:bg-gray-50"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white"
                    style={{ backgroundColor: project.color || "#2563EB" }}
                  >
                    {projectInitial(project.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[#1F2937] truncate">
                      {project.name}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">
                      {project.clientName || "Project"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold",
                      statusTone(project.status),
                    )}
                  >
                    {statusLabel(project.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Leave Balance */}
      <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex flex-col min-h-0 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-[#1F2937] flex items-center gap-2 min-w-0">
            <Umbrella size={16} className="text-[#2563EB] shrink-0" />
            <span className="truncate">Leave Balance</span>
          </h2>
          <button
            type="button"
            onClick={() => navigate("/leaves")}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:text-[#1D4ED8] shrink-0"
          >
            View leave
            <ArrowRight size={11} />
          </button>
        </div>
        {balanceLoading ? (
          <div className="flex flex-1 items-center justify-center py-6">
            <Loader2 className="animate-spin text-gray-400" size={18} />
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {leaveRows.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-2 py-2 first:pt-0.5"
              >
                <span className="text-xs text-[#1F2937] truncate">{row.label}</span>
                <span className="text-xs font-semibold text-[#1F2937] tabular-nums shrink-0">
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Announcements — upcoming holidays */}
      <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex flex-col min-h-0 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-[#1F2937] flex items-center gap-2 min-w-0">
            <Megaphone size={16} className="text-[#2563EB] shrink-0" />
            <span className="truncate">Announcements</span>
          </h2>
          <button
            type="button"
            onClick={() => navigate("/leaves")}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:text-[#1D4ED8] shrink-0"
          >
            View all
            <ArrowRight size={11} />
          </button>
        </div>
        {holidaysLoading ? (
          <div className="flex flex-1 items-center justify-center py-6">
            <Loader2 className="animate-spin text-gray-400" size={18} />
          </div>
        ) : announcements.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-500">
            No upcoming announcements
          </p>
        ) : (
          <ul className="space-y-1.5">
            {announcements.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
                  <Megaphone size={12} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1F2937] line-clamp-1">
                    {item.title}
                  </p>
                  <p className="text-[10px] text-gray-400">{item.subtitle}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDays(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  const label = n === 1 ? "day" : "days";
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  return `${text} ${label}`;
}
