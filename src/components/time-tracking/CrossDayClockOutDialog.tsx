import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { localDateKey, sumBreakSecondsInWindow } from "@/lib/work-hours-policy";
import { trpc } from "@/providers/trpc";
import {
  WorktimeClockColumn,
  WorktimeDurationBar,
  combineDateAndTime,
  formatBreakDurationInput,
  splitTimeParts,
  toDateValue,
} from "@/components/time-tracking/WorktimeClockPicker";
import { formatWorkZoneDate } from "@/lib/timezone";

export function isCrossDaySession(sessionStartTime: Date | string) {
  return localDateKey(new Date(sessionStartTime)) !== localDateKey(new Date());
}

function formatSessionDate(value: Date | string) {
  return formatWorkZoneDate(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function CrossDayClockOutDialog({
  open,
  onOpenChange,
  sessionStartTime,
  isPending,
  onConfirmNow,
  onUpdateTime,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionStartTime: Date | string;
  isPending: boolean;
  onConfirmNow: () => void;
  onUpdateTime: (payload: { clockIn: string; clockOut: string; note: string }) => void;
}) {
  const sessionStart = new Date(sessionStartTime);

  const [clockInDate, setClockInDate] = useState("");
  const [clockInHour, setClockInHour] = useState(0);
  const [clockInMinute, setClockInMinute] = useState(0);
  const [clockOutDate, setClockOutDate] = useState("");
  const [clockOutHour, setClockOutHour] = useState(0);
  const [clockOutMinute, setClockOutMinute] = useState(0);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    const current = new Date();
    const inParts = splitTimeParts(sessionStart);
    const outParts = splitTimeParts(current);
    setClockInDate(toDateValue(sessionStart));
    setClockInHour(inParts.hour);
    setClockInMinute(inParts.minute);
    setClockOutDate(toDateValue(current));
    setClockOutHour(outParts.hour);
    setClockOutMinute(outParts.minute);
    setReason("");
  }, [open, sessionStartTime]);

  const clockIn = clockInDate
    ? combineDateAndTime(clockInDate, clockInHour, clockInMinute)
    : null;
  const clockOut = clockOutDate
    ? combineDateAndTime(clockOutDate, clockOutHour, clockOutMinute)
    : null;

  const canQueryBreaks =
    open && !!clockIn && !!clockOut && clockOut.getTime() > clockIn.getTime();

  const { data: breaksData } = trpc.timeEntry.getBreaks.useQuery(
    {
      from: clockIn?.toISOString(),
      to: clockOut?.toISOString(),
    },
    { enabled: canQueryBreaks },
  );

  const breakSeconds = useMemo(() => {
    if (!clockIn || !clockOut || clockOut <= clockIn || !breaksData?.breaks) return 0;
    return sumBreakSecondsInWindow(breaksData.breaks, clockIn, clockOut);
  }, [clockIn, clockOut, breaksData?.breaks]);

  const workingDaySeconds = useMemo(() => {
    if (!clockIn || !clockOut || clockOut <= clockIn) return 0;
    const spanSeconds = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000);
    return Math.max(0, spanSeconds - breakSeconds);
  }, [clockIn, clockOut, breakSeconds]);

  const breakDuration = formatBreakDurationInput(Math.floor(breakSeconds / 60));

  const timesValid =
    !!clockIn && !!clockOut && clockOut > clockIn && clockOut.getTime() <= Date.now();
  const canSave = reason.trim().length > 0 && timesValid && !isPending;
  const today = toDateValue(new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden" showCloseButton>
        <div className="px-6 pt-6 pb-2">
          <DialogTitle className="text-xl font-bold text-gray-900">Worktime</DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            You clocked in on {formatSessionDate(sessionStart)} but today is{" "}
            {formatSessionDate(new Date())}. Confirm or adjust your times.
          </p>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            <WorktimeClockColumn
              label="Clock in"
              date={clockInDate}
              hour={clockInHour}
              minute={clockInMinute}
              ringClassName="border-lime-400"
              maxDate={today}
              onDateChange={setClockInDate}
              onHourChange={setClockInHour}
              onMinuteChange={setClockInMinute}
            />
            <WorktimeClockColumn
              label="Clock out"
              date={clockOutDate}
              hour={clockOutHour}
              minute={clockOutMinute}
              ringClassName="border-sky-300"
              minDate={clockInDate}
              maxDate={today}
              onDateChange={setClockOutDate}
              onHourChange={setClockOutHour}
              onMinuteChange={setClockOutMinute}
            />
          </div>

          <WorktimeDurationBar label="Working day duration:" totalSeconds={workingDaySeconds} />

          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-gray-600 shrink-0">Break duration:</span>
            <span className="w-28 h-9 px-3 border border-gray-200 rounded-md bg-gray-50 text-right text-sm font-medium tabular-nums flex items-center justify-end text-gray-700">
              {breakDuration}
            </span>
          </div>

          {!timesValid ? (
            <p className="text-xs text-red-600 text-center">
              Clock out must be after clock in and cannot be in the future.
            </p>
          ) : null}

          <label className="block text-sm text-gray-600">
            Reason for time adjustment
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Required to save adjusted times..."
              className="mt-1.5 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white resize-none"
            />
          </label>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
            <button
              type="button"
              disabled={!canSave}
              onClick={() => {
                if (!clockIn || !clockOut) return;
                onUpdateTime({
                  clockIn: clockIn.toISOString(),
                  clockOut: clockOut.toISOString(),
                  note: reason.trim(),
                });
              }}
              className="min-w-[120px] h-10 px-6 rounded-md bg-lime-400 hover:bg-lime-500 disabled:opacity-50 text-sm font-bold tracking-wide text-gray-900 transition-colors flex items-center justify-center gap-2"
            >
              {isPending ? <Loader2 size={16} className="animate-spin" /> : null}
              SAVE
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={onConfirmNow}
              className="min-w-[140px] h-10 px-6 rounded-md bg-sky-100 hover:bg-sky-200 disabled:opacity-50 text-sm font-semibold text-sky-800 transition-colors flex items-center justify-center gap-2"
            >
              {isPending ? <Loader2 size={16} className="animate-spin" /> : null}
              Clock out now
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              className="min-w-[120px] h-10 px-6 rounded-md bg-gray-200 hover:bg-gray-300 text-sm font-bold tracking-wide text-gray-700 transition-colors"
            >
              CLOSE
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
