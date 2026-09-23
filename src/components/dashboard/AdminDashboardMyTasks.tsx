import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { buildMyTasksViewPath } from "@/lib/task-notification-link";
import {
  formatWorkZoneDate,
  workZoneDateKey,
  workZoneDateParts,
  workZoneWallTimeToUtc,
  workZoneWeekday,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";

function startOfWeekKey(now = new Date()) {
  const { year, month, day } = workZoneDateParts(now);
  const weekday = workZoneWeekday(now);
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return workZoneDateKey(workZoneWallTimeToUtc(year, month, day + mondayOffset, 12));
}

function endOfWeekKey(now = new Date()) {
  const start = startOfWeekKey(now);
  const [y, m, d] = start.split("-").map(Number);
  return workZoneDateKey(workZoneWallTimeToUtc(y!, m!, d! + 6, 12));
}

function isDueThisWeek(dueDate: string | Date | null | undefined) {
  if (!dueDate) return false;
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return false;
  const key = workZoneDateKey(d);
  return key >= startOfWeekKey() && key <= endOfWeekKey();
}

function formatDue(dueDate: string | Date | null | undefined) {
  if (!dueDate) return null;
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  return formatWorkZoneDate(d, { day: "numeric", month: "short" });
}

function priorityTone(priority: string | null | undefined) {
  const p = String(priority ?? "").toLowerCase();
  if (p === "high" || p === "urgent") {
    return "bg-red-500/15 text-red-400";
  }
  if (p === "medium") {
    return "bg-orange-500/15 text-orange-400";
  }
  if (p === "low") {
    return "bg-emerald-500/15 text-emerald-400";
  }
  return "bg-slate-500/15 text-slate-400";
}

function priorityLabel(priority: string | null | undefined) {
  const p = String(priority ?? "").toLowerCase();
  if (p === "urgent") return "Urgent";
  if (p === "high") return "High";
  if (p === "medium") return "Medium";
  if (p === "low") return "Low";
  return "Normal";
}

export function AdminDashboardMyTasks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id ?? 0;

  const { data, isLoading } = trpc.task.list.useQuery(
    { assigneeId: userId, limit: 100 },
    { enabled: userId > 0, staleTime: 30_000 },
  );

  const tasks = useMemo(() => {
    const list = data?.tasks ?? [];
    const dueSoon = list.filter((task) => isDueThisWeek(task.dueDate));
    const source = dueSoon.length > 0 ? dueSoon : list;
    return source.slice(0, 6);
  }, [data?.tasks]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col h-full min-h-[300px] dark:border-[#30363d] dark:bg-[#161b22]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-[#1F2937] dark:text-white">My Tasks</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Due this week</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/admin/tasks")}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:underline dark:text-[#60A5FA]"
        >
          View all
          <ArrowRight size={12} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-slate-600" size={22} />
          </div>
        ) : tasks.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">No tasks due this week</p>
        ) : (
          tasks.map((task) => {
            const done = String(task.status ?? "").toLowerCase() === "done";
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => navigate(buildMyTasksViewPath(task.id))}
                className="w-full flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-left hover:border-[#3B82F6]/40 transition-colors dark:border-[#1C2330] dark:bg-[#0B0E14]"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium truncate",
                      done ? "text-slate-500 line-through" : "text-[#1F2937] dark:text-white",
                    )}
                  >
                    {task.title}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    {task.project?.name || "No project"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                      priorityTone(task.priority),
                    )}
                  >
                    {priorityLabel(task.priority)}
                  </span>
                  {formatDue(task.dueDate) ? (
                    <span className="text-[10px] text-slate-500">{formatDue(task.dueDate)}</span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
