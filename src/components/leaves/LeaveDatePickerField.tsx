"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DayButton } from "react-day-picker";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  calendarDateValue,
  parseDateValue,
} from "@/components/time-tracking/WorktimeClockPicker";
import { eachLeaveDateKey, toLeaveDateKey } from "@/lib/leave-policy";
import { formatWorkZoneDateKey } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const APPROVED_LEAVE_DAY_TIP =
  "Employee has already taken leave on this day.";

type ExistingLeave = {
  userId: number;
  status: string;
  startDate: string;
  endDate: string;
};

/** YYYY-MM-DD keys covered by approved leave for a given employee. */
export function approvedLeaveDateKeysForUser(
  existingLeaves: ExistingLeave[],
  userId: number | "",
): Set<string> {
  const keys = new Set<string>();
  if (userId === "") return keys;
  const uid = Number(userId);
  for (const req of existingLeaves) {
    if (Number(req.userId) !== uid) continue;
    if (String(req.status ?? "").toLowerCase() !== "approved") continue;
    const start = toLeaveDateKey(req.startDate);
    const end = toLeaveDateKey(req.endDate) ?? start;
    if (!start || !end) continue;
    for (const key of eachLeaveDateKey(start, end)) keys.add(key);
  }
  return keys;
}

function ApprovedLeaveDayButton({
  blockedDates,
  ...props
}: ComponentProps<typeof DayButton> & { blockedDates: Set<string> }) {
  const dateKey = calendarDateValue(props.day.date);
  const blocked = blockedDates.has(dateKey);

  const button = (
    <CalendarDayButton
      {...props}
      title={blocked ? APPROVED_LEAVE_DAY_TIP : props.title}
      aria-label={
        blocked
          ? `${props.day.date.getDate()}, ${APPROVED_LEAVE_DAY_TIP}`
          : props["aria-label"]
      }
      className={cn(
        props.className,
        blocked && "line-through decoration-red-400/70",
      )}
    />
  );

  if (!blocked) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Span receives hover — disabled day buttons do not. */}
        <span className="flex h-full w-full cursor-not-allowed">{button}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] z-[60]">
        {APPROVED_LEAVE_DAY_TIP}
      </TooltipContent>
    </Tooltip>
  );
}

const CALENDAR_YEAR_RANGE = (() => {
  const year = new Date().getFullYear();
  return {
    startMonth: new Date(year - 2, 0),
    endMonth: new Date(year + 3, 11),
  };
})();

export function LeaveDatePickerField({
  value,
  onChange,
  blockedDates,
  minDate,
  placeholder = "Select date",
  disabled = false,
  className,
  focusRingClassName = "focus:ring-[#2563EB]/20 focus:border-[#2563EB]",
}: {
  value: string;
  onChange: (next: string) => void;
  blockedDates: Set<string>;
  minDate?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  focusRingClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseDateValue(value) : undefined;
  const min = minDate ? parseDateValue(minDate) : undefined;
  const defaultMonth = selected ?? new Date();

  const DayButtonWithLeave = useMemo(() => {
    function BoundDayButton(props: ComponentProps<typeof DayButton>) {
      return <ApprovedLeaveDayButton {...props} blockedDates={blockedDates} />;
    }
    return BoundDayButton;
  }, [blockedDates]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "w-full h-10 px-3 rounded-lg border border-gray-200 text-sm text-left inline-flex items-center gap-2 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed bg-white",
            focusRingClassName,
            value ? "text-[#1F2937]" : "text-gray-400",
            className,
          )}
        >
          <CalendarIcon size={15} className="text-gray-400 shrink-0" />
          <span className="truncate">
            {value
              ? formatWorkZoneDateKey(value, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[340px] p-0" align="start">
        <TooltipProvider delayDuration={200}>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={defaultMonth}
            captionLayout="dropdown"
            startMonth={CALENDAR_YEAR_RANGE.startMonth}
            endMonth={CALENDAR_YEAR_RANGE.endMonth}
            formatters={{
              formatMonthDropdown: (date) =>
                date.toLocaleString("default", { month: "long" }),
            }}
            className="w-full min-w-[320px] [--cell-size:2.75rem]"
            onSelect={(next) => {
              if (!next) return;
              const key = calendarDateValue(next);
              if (blockedDates.has(key)) return;
              onChange(key);
              setOpen(false);
            }}
            disabled={(day) => {
              const key = calendarDateValue(day);
              if (blockedDates.has(key)) return true;
              if (min) {
                const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
                const minStart = new Date(min.getFullYear(), min.getMonth(), min.getDate());
                if (dayStart < minStart) return true;
              }
              return false;
            }}
            components={{ DayButton: DayButtonWithLeave }}
            initialFocus
          />
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
