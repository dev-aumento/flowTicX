import { useNavigate } from "react-router";
import { ArrowRight, Loader2, Pause, Square } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useTaskLiveTimer } from "@/hooks/useTaskLiveTimer";
import { formatElapsedHMS } from "@/lib/utils";
import { formatWorkZoneTime } from "@/lib/timezone";
import { buildMyTasksViewPath } from "@/lib/task-notification-link";
import { invalidateActiveTaskTimers } from "@/lib/invalidate-task-timers";
import { invalidateTaskQueries } from "@/lib/invalidate-on-notifications";

export function DashboardCurrentTimerCard() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const { data: activeTimer, isLoading } = trpc.task.getMyActiveTimer.useQuery(
    undefined,
    {
      refetchInterval: (query) => (query.state.data ? 5_000 : false),
      staleTime: 2_000,
    },
  );

  const { elapsedSeconds } = useTaskLiveTimer(activeTimer ?? null);

  const stopMutation = trpc.task.stopTimer.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.task.getMyActiveTimer.invalidate(),
        invalidateTaskQueries(utils),
      ]);
      invalidateActiveTaskTimers(utils);
      toast.success("Timer stopped");
    },
    onError: (err) => toast.error(err.message || "Could not stop timer"),
  });

  const hasTimer = !!activeTimer?.taskId;
  const startedLabel = activeTimer?.startedAt
    ? formatWorkZoneTime(activeTimer.startedAt, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 h-full flex flex-col min-h-[300px]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-[#1F2937]">Current Timer</h2>
        {hasTimer ? (
          <button
            type="button"
            onClick={() => navigate(buildMyTasksViewPath(activeTimer.taskId))}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
          >
            View timer
            <ArrowRight size={12} />
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="animate-spin text-gray-400" size={22} />
        </div>
      ) : !hasTimer ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center px-3">
          <p className="text-xs font-medium text-gray-600">No timer running</p>
          <p className="mt-1 text-[11px] text-gray-400">
            Start a timer from a task to track time here.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-3">
            <p className="text-xs font-semibold text-[#1F2937] line-clamp-2">
              {activeTimer.taskTitle}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-2xl font-bold font-mono tracking-tight text-[#1F2937]">
              {formatElapsedHMS(elapsedSeconds)}
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#2563EB]/30 bg-[#EFF6FF] text-[#2563EB]">
              {activeTimer.paused ? (
                <Pause size={16} />
              ) : (
                <Square size={14} fill="currentColor" />
              )}
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-medium text-emerald-700">
              {activeTimer.paused ? "Paused" : "Tracking time"}
            </span>
            {startedLabel ? (
              <span className="text-gray-400">· Started at {startedLabel}</span>
            ) : null}
          </div>

          <button
            type="button"
            disabled={stopMutation.isPending}
            onClick={() => stopMutation.mutate({ taskId: activeTimer.taskId })}
            className="mt-auto w-full h-9 rounded-lg border-2 border-red-400 text-red-600 font-semibold text-xs hover:bg-red-50 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {stopMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Square size={12} fill="currentColor" />
            )}
            Stop Timer
          </button>
        </>
      )}
    </div>
  );
}
