import { trpc } from "@/providers/trpc";
import { useLiveSessionTimers } from "@/hooks/useLiveSessionTimers";
import { useClockOutAction } from "@/hooks/useClockOutAction";
import { invalidateActiveTaskTimers } from "@/lib/invalidate-task-timers";
import { runClockInWithLocation } from "@/lib/clock-in-with-location";
import { formatElapsedHMS } from "@/lib/utils";
import { toast } from "sonner";

export function useWorkdayClock() {
  const utils = trpc.useUtils();
  const { data: todayStats } = trpc.timeEntry.getStats.useQuery(
    { period: "today" },
    { staleTime: 30_000 },
  );
  const { data: currentSession, refetch: refetchSession } = trpc.timeEntry.getCurrentSession.useQuery(
    undefined,
    { staleTime: 15_000, refetchInterval: 30_000 },
  );

  const isClockedIn = !!currentSession?.active;
  const isPaused = !!currentSession?.paused;
  const { workSeconds } = useLiveSessionTimers(isClockedIn ? currentSession : null);
  const priorWorkSeconds = currentSession?.priorDayWorkSeconds ?? 0;
  const cumulativeWorkSeconds = priorWorkSeconds + workSeconds;
  const shownSeconds = isClockedIn ? cumulativeWorkSeconds : (todayStats?.totalSeconds ?? 0);

  const invalidateTime = () => {
    utils.timeEntry.getCurrentSession.invalidate();
    utils.timeEntry.getStats.invalidate();
    utils.timeEntry.getBreaks.invalidate();
    utils.timeEntry.list.invalidate();
    utils.timeEntry.listPendingApprovals.invalidate();
    utils.dashboard.getStats.invalidate();
    utils.notification.list.invalidate();
    invalidateActiveTaskTimers(utils);
  };

  const clockOutAction = useClockOutAction(() => {
    invalidateTime();
    void refetchSession();
  });

  const clockInMutation = trpc.timeEntry.clockIn.useMutation({
    onSuccess: () => {
      invalidateTime();
      void refetchSession();
    },
    onError: (err) => toast.error(err.message || "Could not clock in"),
  });

  const pauseMutation = trpc.timeEntry.pauseSession.useMutation({
    onSuccess: () => {
      invalidateTime();
      void refetchSession();
    },
    onError: (err) => toast.error(err.message || "Could not pause"),
  });

  const resumeMutation = trpc.timeEntry.resumeSession.useMutation({
    onSuccess: () => {
      invalidateTime();
      void refetchSession();
    },
    onError: (err) => toast.error(err.message || "Could not resume"),
  });

  const isBusy =
    clockInMutation.isPending ||
    clockOutAction.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending;

  const subtitle = isClockedIn ? (isPaused ? "On break" : "Working day") : "Not started";

  return {
    currentSession,
    isClockedIn,
    isPaused,
    isBusy,
    subtitle,
    timerLabel: formatElapsedHMS(shownSeconds),
    clockOutAction,
    togglePower: () => {
      if (isBusy) return;
      if (isClockedIn) {
        clockOutAction.requestClockOut(currentSession?.startTime);
        return;
      }
      void runClockInWithLocation((input) => clockInMutation.mutateAsync(input), {
        isLocationRequired: async () => (await utils.location.clockInPolicy.fetch()).required,
      });
    },
    togglePause: () => {
      if (isBusy || !isClockedIn) return;
      if (isPaused) resumeMutation.mutate();
      else pauseMutation.mutate();
    },
  };
}
