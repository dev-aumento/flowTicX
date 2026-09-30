import { calendarYmdKey, parseIsoDateOnly, workZoneDateParts } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
] as const;

function daysInMonth(year: number, month: number) {
  if (!year || !month) return 31;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const selectClass =
  "h-10 w-full min-w-0 px-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

export function CalendarDateSelect({
  value,
  onChange,
  minYear,
  maxYear,
  className,
}: {
  /** YYYY-MM-DD or empty */
  value: string;
  onChange: (next: string) => void;
  minYear?: number;
  maxYear?: number;
  className?: string;
}) {
  const now = workZoneDateParts(new Date());
  const parsed = value ? parseIsoDateOnly(value) : null;
  const yearMin = minYear ?? 1920;
  const yearMax = maxYear ?? now.year;
  const day = parsed?.day ?? 0;
  const month = parsed?.month ?? 0;
  const year = parsed?.year ?? 0;
  const maxDay = daysInMonth(year || now.year, month || 1);

  const years: number[] = [];
  for (let y = yearMax; y >= yearMin; y -= 1) years.push(y);
  if (year && !years.includes(year)) {
    years.push(year);
    years.sort((a, b) => b - a);
  }

  const commit = (next: { day: number; month: number; year: number }) => {
    if (!next.day || !next.month || !next.year) {
      onChange("");
      return;
    }
    const clampedDay = Math.min(next.day, daysInMonth(next.year, next.month));
    onChange(calendarYmdKey({ year: next.year, month: next.month, day: clampedDay }));
  };

  return (
    <div className={cn("grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_5rem] gap-2", className)}>
      <select
        aria-label="Day"
        value={day || ""}
        onChange={(e) =>
          commit({ day: Number(e.target.value) || 0, month, year })
        }
        className={selectClass}
      >
        <option value="">Day</option>
        {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        aria-label="Month"
        value={month || ""}
        onChange={(e) =>
          commit({ day, month: Number(e.target.value) || 0, year })
        }
        className={selectClass}
      >
        <option value="">Month</option>
        {MONTHS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Year"
        value={year || ""}
        onChange={(e) =>
          commit({ day, month, year: Number(e.target.value) || 0 })
        }
        className={selectClass}
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
