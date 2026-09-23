import { useMemo } from "react";
import { ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  formatWorkZoneDateKey,
  workZoneDateKey,
  workZoneDateParts,
  workZoneWallTimeToUtc,
} from "@/lib/timezone";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** IST calendar date key for a timestamp. */
export function toDateValue(date: Date) {
  return workZoneDateKey(date);
}

/** Calendar day-picker selection → YYYY-MM-DD (day the user clicked). */
export function calendarDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateValue(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Noon UTC avoids DST/edge issues when feeding react-day-picker.
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Interpret date + time as IST wall clock. */
export function combineDateAndTime(dateStr: string, hour: number, minute: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return workZoneWallTimeToUtc(y, m, d, hour, minute, 0, 0);
}

export function splitTimeParts(date: Date) {
  const parts = workZoneDateParts(date);
  return { hour: parts.hour, minute: parts.minute };
}

function formatDayLabel(dateStr: string) {
  return formatWorkZoneDateKey(dateStr, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AnalogClockFace({
  hour,
  minute,
  ringClassName,
}: {
  hour: number;
  minute: number;
  ringClassName: string;
}) {
  const hourAngle = ((hour % 12) + minute / 60) * 30;
  const minuteAngle = minute * 6;

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 - 90) * (Math.PI / 180);
    const x1 = 50 + Math.cos(angle) * 38;
    const y1 = 50 + Math.sin(angle) * 38;
    const x2 = 50 + Math.cos(angle) * 44;
    const y2 = 50 + Math.sin(angle) * 44;
    return { x1, y1, x2, y2, key: i };
  });

  return (
    <div
      className={cn(
        "relative w-[148px] h-[148px] rounded-full border-[6px] bg-white shadow-inner",
        ringClassName,
      )}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-2 w-[calc(100%-1rem)] h-[calc(100%-1rem)]">
        {ticks.map((tick) => (
          <line
            key={tick.key}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke="#9ca3af"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ))}
        <line
          x1="50"
          y1="50"
          x2={50 + Math.cos((hourAngle - 90) * (Math.PI / 180)) * 22}
          y2={50 + Math.sin((hourAngle - 90) * (Math.PI / 180)) * 22}
          stroke="#374151"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="50"
          y1="50"
          x2={50 + Math.cos((minuteAngle - 90) * (Math.PI / 180)) * 30}
          y2={50 + Math.sin((minuteAngle - 90) * (Math.PI / 180)) * 30}
          stroke="#6b7280"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="50" cy="50" r="2.5" fill="#374151" />
      </svg>
    </div>
  );
}

function TimeSpinner({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: number;
  minute: number;
  onHourChange: (hour: number) => void;
  onMinuteChange: (minute: number) => void;
}) {
  const bumpHour = (delta: number) => {
    onHourChange((hour + delta + 24) % 24);
  };
  const bumpMinute = (delta: number) => {
    onMinuteChange((minute + delta + 60) % 60);
  };

  return (
    <div className="flex items-center justify-center gap-3 mt-4">
      <SpinnerColumn value={hour} onUp={() => bumpHour(1)} onDown={() => bumpHour(-1)} />
      <span className="text-2xl font-light text-gray-400 pb-1">:</span>
      <SpinnerColumn value={minute} onUp={() => bumpMinute(1)} onDown={() => bumpMinute(-1)} />
    </div>
  );
}

function SpinnerColumn({
  value,
  onUp,
  onDown,
}: {
  value: number;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={onUp}
        className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Increase"
      >
        <ChevronUp size={16} />
      </button>
      <div className="min-w-[3.25rem] h-11 px-2 border border-gray-200 rounded-md bg-white text-center text-xl font-semibold text-gray-800 tabular-nums flex items-center justify-center">
        {pad(value)}
      </div>
      <button
        type="button"
        onClick={onDown}
        className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Decrease"
      >
        <ChevronDown size={16} />
      </button>
    </div>
  );
}

export function WorktimeClockColumn({
  label,
  date,
  hour,
  minute,
  ringClassName,
  minDate,
  maxDate,
  onDateChange,
  onHourChange,
  onMinuteChange,
}: {
  label: string;
  date: string;
  hour: number;
  minute: number;
  ringClassName: string;
  minDate?: string;
  maxDate?: string;
  onDateChange: (date: string) => void;
  onHourChange: (hour: number) => void;
  onMinuteChange: (minute: number) => void;
}) {
  const selectedDate = useMemo(() => parseDateValue(date), [date]);
  const min = minDate ? parseDateValue(minDate) : undefined;
  const max = maxDate ? parseDateValue(maxDate) : undefined;

  return (
    <div className="flex flex-col items-center text-center">
      <p className="text-sm font-medium text-gray-700 mb-4">{label}</p>
      <AnalogClockFace hour={hour} minute={minute} ringClassName={ringClassName} />
      <TimeSpinner
        hour={hour}
        minute={minute}
        onHourChange={onHourChange}
        onMinuteChange={onMinuteChange}
      />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="mt-3 text-sm text-gray-500 underline underline-offset-2 hover:text-gray-700 transition-colors"
          >
            Change day
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(next) => {
              if (!next) return;
              onDateChange(calendarDateValue(next));
            }}
            disabled={(day) => {
              if (min && day < new Date(min.getFullYear(), min.getMonth(), min.getDate())) {
                return true;
              }
              if (max && day > new Date(max.getFullYear(), max.getMonth(), max.getDate())) {
                return true;
              }
              return false;
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <p className="mt-1.5 text-xs text-gray-400">{formatDayLabel(date)}</p>
    </div>
  );
}

export function WorktimeDurationBar({
  label,
  totalSeconds,
}: {
  label: string;
  totalSeconds: number;
}) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const labelText = h > 0 ? `${h}h ${m}m` : `${m}m`;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-100 rounded-lg text-sm text-gray-600">
      <span>{label}</span>
      <span className="flex items-center gap-1.5 font-semibold text-gray-800 tabular-nums">
        <Clock size={15} className="text-gray-500" />
        {labelText}
      </span>
    </div>
  );
}

export function formatBreakDurationInput(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${pad(h)}:${pad(m)}`;
}

export function parseBreakDurationInput(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}
