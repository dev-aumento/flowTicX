import type { MonthAttendanceSummary } from "@/lib/month-attendance";
import { CalendarCheck2 } from "lucide-react";
import { cn } from "@/lib/utils";

function daysLabel(count: number) {
  if (count === 0.5) return "0.5 Day";
  return `${count} Day${count === 1 ? "" : "s"}`;
}

function possessiveName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}

type AttendanceCardProps = {
  data?: MonthAttendanceSummary | null;
  isLoading?: boolean;
  className?: string;
  compact?: boolean;
  /** When set (HR view), title/warning use this name instead of "Your". */
  employeeName?: string | null;
};

export function MonthAttendanceCard({
  data,
  isLoading,
  className,
  compact,
  employeeName,
}: AttendanceCardProps) {
  const metrics = [
    { label: "Working days", value: daysLabel(data?.workingDays ?? 0) },
    { label: "Attendance", value: daysLabel(data?.attendanceDays ?? 0) },
    { label: "Late", value: daysLabel(data?.lateDays ?? 0) },
    { label: "Absent", value: daysLabel(data?.absentDays ?? 0) },
    {
      label: "Worked hours",
      value: data?.workedHoursLabel ?? "0 hr 0 mins",
      wide: true,
    },
  ];

  const name = employeeName?.trim() || "";
  const title = name
    ? `Record ${possessiveName(name)} Attendance`
    : compact
      ? "Attendance"
      : "Record Your Attendance";
  const warningPrefix = name ? possessiveName(name) : "Your";

  return (
    <div
      className={cn(
        "bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col",
        compact ? "p-3.5" : "p-5",
        className,
      )}
    >
      <div className={cn("flex items-start justify-between gap-2", compact ? "mb-2" : "mb-3")}>
        <div className="min-w-0">
          <h2
            className={cn(
              "font-semibold text-[#1F2937] flex items-center gap-2",
              compact ? "text-sm" : "",
            )}
          >
            <CalendarCheck2
              size={compact ? 16 : 18}
              className="text-[#2563EB] shrink-0"
            />
            <span className="truncate">{title}</span>
          </h2>
          <p className={cn("text-gray-500 mt-1", compact ? "text-[10px] leading-snug" : "text-xs")}>
            {data?.monthLabel ?? "This month"}
            {compact
              ? data != null
                ? ` · ${data.workingDays} working days`
                : ""
              : ` · Full month Mon–Fri${
                  data != null ? ` (${data.workingDays} working days)` : ""
                }`}
          </p>
        </div>
      </div>

      <div className={cn("border-t border-gray-100 flex-1", compact ? "pt-2" : "pt-3")}>
        {isLoading ? (
          <div
            className={cn(
              "grid animate-pulse",
              compact ? "grid-cols-2 gap-2" : "grid-cols-2 sm:grid-cols-3 gap-3",
            )}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-16 bg-gray-100 rounded" />
                <div className="h-4 w-20 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div
            className={cn(
              "grid",
              compact
                ? "grid-cols-2 gap-x-3 gap-y-2"
                : "grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3",
            )}
          >
            {metrics.map((m) => (
              <div
                key={m.label}
                className={
                  !compact && m.wide ? "sm:col-span-1 col-span-2" : undefined
                }
              >
                <div
                  className={cn(
                    "font-semibold text-[#1F2937]",
                    compact ? "text-[11px]" : "text-sm",
                  )}
                >
                  {m.label}
                </div>
                <div
                  className={cn(
                    "text-gray-500 mt-0.5",
                    compact ? "text-[11px]" : "text-sm",
                  )}
                >
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isLoading && data?.shortStaffingWarning ? (
        <div
          className={cn(
            "rounded-lg bg-orange-50 border border-orange-100 text-orange-700 font-medium",
            compact
              ? "mt-2 px-2 py-1.5 text-[10px] leading-snug"
              : "mt-4 px-3 py-2.5 text-sm",
          )}
        >
          {warningPrefix} previous staffing was less than 08:30 hours
        </div>
      ) : null}
    </div>
  );
}
