import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { localDateKey, sumBreakSecondsInWindow } from "@/lib/work-hours-policy";
import {
  WorktimeClockColumn,
  WorktimeDurationBar,
  combineDateAndTime,
  formatBreakDurationInput,
  parseBreakDurationInput,
  splitTimeParts,
  toDateValue,
} from "@/components/time-tracking/WorktimeClockPicker";
import {
  formatWorkZoneDate,
  formatWorkZoneDateTime,
  formatWorkZoneTime,
} from "@/lib/timezone";

export type AttendanceEntryRow = {
  id: number;
  clockIn: Date | string;
  clockOut?: Date | string | null;
  duration?: number | null;
  durationSeconds?: number | null;
  note?: string | null;
};

function formatDateTimeLabel(value: Date | string) {
  return formatWorkZoneDateTime(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function EditAttendanceEntryDialog({
  open,
  onOpenChange,
  entry,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: AttendanceEntryRow | null;
  onSuccess?: () => void;
}) {
  const [clockInDate, setClockInDate] = useState("");
  const [clockInHour, setClockInHour] = useState(0);
  const [clockInMinute, setClockInMinute] = useState(0);
  const [clockOutDate, setClockOutDate] = useState("");
  const [clockOutHour, setClockOutHour] = useState(0);
  const [clockOutMinute, setClockOutMinute] = useState(0);
  const [breakDuration, setBreakDuration] = useState("00:00");
  const [breakEdited, setBreakEdited] = useState(false);
  const [reason, setReason] = useState("");

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

  const updateMutation = trpc.timeEntry.updateAttendanceEntry.useMutation({
    onSuccess: () => {
      onSuccess?.();
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open || !entry?.clockOut) return;
    const inDt = new Date(entry.clockIn);
    const outDt = new Date(entry.clockOut);
    const inParts = splitTimeParts(inDt);
    const outParts = splitTimeParts(outDt);
    setClockInDate(toDateValue(inDt));
    setClockInHour(inParts.hour);
    setClockInMinute(inParts.minute);
    setClockOutDate(toDateValue(outDt));
    setClockOutHour(outParts.hour);
    setClockOutMinute(outParts.minute);
    setBreakDuration("00:00");
    setBreakEdited(false);
    setReason("");
  }, [open, entry]);

  const breakSeconds = useMemo(() => {
    if (!clockIn || !clockOut || clockOut <= clockIn || !breaksData?.breaks) return 0;
    return sumBreakSecondsInWindow(breaksData.breaks, clockIn, clockOut);
  }, [clockIn, clockOut, breaksData?.breaks]);

  const spanSeconds = useMemo(() => {
    if (!clockIn || !clockOut || clockOut <= clockIn) return 0;
    return Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000);
  }, [clockIn, clockOut]);

  useEffect(() => {
    if (!open || !canQueryBreaks || breakEdited) return;

    const breakFromRecords = Math.floor(breakSeconds / 60);
    if (breakFromRecords > 0) {
      setBreakDuration(formatBreakDurationInput(breakFromRecords));
      return;
    }

    if (entry?.clockOut && clockIn && clockOut) {
      const spanMin = Math.floor(spanSeconds / 60);
      const workMin =
        entry.durationSeconds != null
          ? Math.floor(entry.durationSeconds / 60)
          : entry.duration ?? spanMin;
      const inferredBreak = Math.max(0, spanMin - workMin);
      if (inferredBreak > 0) {
        setBreakDuration(formatBreakDurationInput(inferredBreak));
        return;
      }
    }

    setBreakDuration(formatBreakDurationInput(breakFromRecords));
  }, [open, canQueryBreaks, breakSeconds, breakEdited, entry, spanSeconds, clockIn, clockOut]);

  const breakMinutes = parseBreakDurationInput(breakDuration);

  const workingDaySeconds = useMemo(() => {
    if (!spanSeconds) return 0;
    return Math.max(0, spanSeconds - breakMinutes * 60);
  }, [spanSeconds, breakMinutes]);

  const breakTooLong = spanSeconds > 0 && breakMinutes * 60 > spanSeconds;

  const timesValid =
    !!clockIn &&
    !!clockOut &&
    clockOut > clockIn &&
    clockOut.getTime() <= Date.now();

  const canSave =
    !!entry?.clockOut &&
    reason.trim().length > 0 &&
    timesValid &&
    !breakTooLong &&
    !updateMutation.isPending;

  const today = toDateValue(new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl p-0 gap-0 overflow-hidden"
        showCloseButton
      >
        <div className="px-6 pt-6 pb-2">
          <DialogTitle className="text-xl font-bold text-gray-900">Worktime</DialogTitle>
        </div>

        {!entry?.clockOut ? (
          <p className="text-sm text-gray-500 px-6 py-4">
            Only completed clock-in / clock-out cycles can be edited.
          </p>
        ) : (
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

            <WorktimeDurationBar
              label="Working day duration:"
              totalSeconds={workingDaySeconds}
            />

            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-gray-600 shrink-0">Break duration:</span>
              <input
                type="text"
                value={breakDuration}
                onChange={(e) => {
                  setBreakEdited(true);
                  setBreakDuration(e.target.value);
                }}
                onBlur={() => {
                  setBreakDuration(formatBreakDurationInput(breakMinutes));
                }}
                placeholder="00:00"
                className="w-28 h-9 px-3 border border-gray-200 rounded-md bg-white text-right text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-lime-400/50"
              />
            </div>

            {breakTooLong ? (
              <p className="text-xs text-red-600 text-center">
                Break duration cannot be longer than the clock-in to clock-out span.
              </p>
            ) : null}

            {!timesValid ? (
              <p className="text-xs text-red-600 text-center">
                Clock out must be after clock in and cannot be in the future.
              </p>
            ) : null}

            <label className="block text-sm text-gray-600">
              Reason for change
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Required to save changes..."
                className="mt-1.5 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white resize-none"
              />
            </label>

            {updateMutation.error ? (
              <p className="text-xs text-red-600 text-center">{updateMutation.error.message}</p>
            ) : null}

            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                disabled={!canSave}
                onClick={() => {
                  if (!entry?.clockOut || !clockIn || !clockOut) return;
                  updateMutation.mutate({
                    id: entry.id,
                    clockIn: clockIn.toISOString(),
                    clockOut: clockOut.toISOString(),
                    breakMinutes,
                    reason: reason.trim(),
                  });
                }}
                className="min-w-[120px] h-10 px-6 rounded-md bg-lime-400 hover:bg-lime-500 disabled:opacity-50 disabled:hover:bg-lime-400 text-sm font-bold tracking-wide text-gray-900 transition-colors flex items-center justify-center gap-2"
              >
                {updateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
                SAVE
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={updateMutation.isPending}
                className="min-w-[120px] h-10 px-6 rounded-md bg-gray-200 hover:bg-gray-300 text-sm font-bold tracking-wide text-gray-700 transition-colors"
              >
                CLOSE
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function formatEntryDateTimeRange(clockIn: Date | string, clockOut?: Date | string | null) {
  if (!clockOut) {
    return `${formatDateTimeLabel(clockIn)} – In progress`;
  }
  const inKey = localDateKey(new Date(clockIn));
  const outKey = localDateKey(new Date(clockOut));
  if (inKey === outKey) {
    const date = formatWorkZoneDate(clockIn, {
      day: "numeric",
      month: "short",
    });
    const start = formatWorkZoneTime(clockIn, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const end = formatWorkZoneTime(clockOut, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return `${date}, ${start} – ${end}`;
  }
  return `${formatDateTimeLabel(clockIn)} – ${formatDateTimeLabel(clockOut)}`;
}
