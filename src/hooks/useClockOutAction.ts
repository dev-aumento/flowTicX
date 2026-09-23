import { useCallback, useState } from "react";
import { trpc } from "@/providers/trpc";
import { isCrossDaySession } from "@/components/time-tracking/CrossDayClockOutDialog";
import { invalidateActiveTaskTimers } from "@/lib/invalidate-task-timers";

type ClockOutInput = {
  note?: string;
  clockIn?: string;
  clockOut?: string;
};

export function useClockOutAction(onSuccess?: () => void) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingNote, setPendingNote] = useState<string | undefined>();
  const utils = trpc.useUtils();

  const invalidateTime = useCallback(() => {
    utils.timeEntry.getCurrentSession.invalidate();
    utils.timeEntry.getStats.invalidate();
    utils.timeEntry.getDayHours.invalidate();
    utils.timeEntry.getTeamHours.invalidate();
    utils.timeEntry.getBreaks.invalidate();
    utils.timeEntry.listPendingApprovals.invalidate();
    utils.dashboard.getStats.invalidate();
    invalidateActiveTaskTimers(utils);
  }, [utils]);

  const clockOutMutation = trpc.timeEntry.clockOut.useMutation({
    onSuccess: () => {
      invalidateTime();
      setDialogOpen(false);
      setPendingNote(undefined);
      onSuccess?.();
    },
  });

  const requestClockOut = useCallback(
    (sessionStartTime: Date | string | undefined, note?: string) => {
      if (!sessionStartTime) return;

      if (isCrossDaySession(sessionStartTime)) {
        setPendingNote(note);
        setDialogOpen(true);
        return;
      }

      clockOutMutation.mutate({ note });
    },
    [clockOutMutation],
  );

  const confirmClockOutNow = useCallback(() => {
    clockOutMutation.mutate({ note: pendingNote });
  }, [clockOutMutation, pendingNote]);

  const updateClockOutTime = useCallback(
    (payload: { clockIn: string; clockOut: string; note: string }) => {
      clockOutMutation.mutate({
        clockIn: payload.clockIn,
        clockOut: payload.clockOut,
        note: payload.note,
      });
    },
    [clockOutMutation],
  );

  return {
    requestClockOut,
    confirmClockOutNow,
    updateClockOutTime,
    dialogOpen,
    setDialogOpen,
    isPending: clockOutMutation.isPending,
    clockOutError: clockOutMutation.error,
  };
}
