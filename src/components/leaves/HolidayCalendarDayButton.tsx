"use client";

import type { ComponentProps } from "react";
import { CalendarDayButton } from "@/components/ui/calendar";
import { calendarDateValue } from "@/components/time-tracking/WorktimeClockPicker";
import type { DayButton } from "react-day-picker";
import { cn } from "@/lib/utils";
import { HolidayVisualBadge } from "@/components/leaves/HolidayVisualBadge";
import type { HolidayVisual } from "@/lib/holiday-icons";

export type CalendarHolidayBadge = {
  name: string;
  visual: Pick<HolidayVisual, "emoji" | "flag" | "label">;
};

type Props = ComponentProps<typeof DayButton> & {
  holidayByDate: Map<string, CalendarHolidayBadge>;
};

/** Day cell that overlays a public-holiday badge when that date is a company holiday. */
export function HolidayCalendarDayButton({ holidayByDate, className, children, ...props }: Props) {
  const dateKey = calendarDateValue(props.day.date);
  const holiday = holidayByDate.get(dateKey);

  return (
    <CalendarDayButton
      {...props}
      title={holiday ? `${holiday.name} (public holiday)` : props.title}
      aria-label={
        holiday
          ? `${props.day.date.getDate()}, ${holiday.name}, public holiday`
          : props["aria-label"]
      }
      className={cn(
        "relative",
        className,
        holiday && "bg-amber-50/90 text-amber-950 data-[selected-single=true]:bg-primary",
      )}
    >
      {children}
      {holiday ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 right-0.5 leading-none"
        >
          <HolidayVisualBadge
            visual={holiday.visual}
            className="text-[10px]"
            flagClassName="h-2.5 w-[15px]"
          />
        </span>
      ) : null}
    </CalendarDayButton>
  );
}
