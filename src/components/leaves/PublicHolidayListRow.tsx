import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatWorkZoneDateKey } from "@/lib/timezone";
import { holidayOccurrence } from "@/lib/public-holidays";
import { holidayVisualForName } from "@/lib/holiday-icons";
import { HolidayVisualBadge } from "@/components/leaves/HolidayVisualBadge";

type Props = {
  date: string;
  name: string;
  todayKey: string;
  actions?: ReactNode;
  className?: string;
};

const STATUS_LABEL: Record<ReturnType<typeof holidayOccurrence>, string> = {
  past: "Past",
  today: "Today",
  upcoming: "Upcoming",
};

/** One public-holiday row. Past dates are visually disabled so upcoming days stand out. */
export function PublicHolidayListRow({ date, name, todayKey, actions, className }: Props) {
  const occurrence = holidayOccurrence(date, todayKey);
  const isPast = occurrence === "past";
  const visual = holidayVisualForName(name, date);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        isPast && "bg-gray-50",
        occurrence === "today" && "bg-amber-50/80",
        className,
      )}
      aria-disabled={isPast || undefined}
      title={
        isPast
          ? `${name} has already passed`
          : occurrence === "today"
            ? `${name} is today`
            : `${name} is upcoming`
      }
    >
      <div
        className={cn(
          "flex items-start gap-2.5 min-w-0",
          isPast && "opacity-40 grayscale",
        )}
      >
        <HolidayVisualBadge
          visual={visual}
          className="text-lg mt-0.5 shrink-0"
          flagClassName="h-4 w-6 mt-0.5"
        />
        <div className="min-w-0">
          <div
            className={cn(
              "text-sm font-medium",
              isPast ? "text-gray-500" : "text-gray-800",
            )}
          >
            {name}
          </div>
          <div className={cn("text-xs mt-0.5", isPast ? "text-gray-400" : "text-gray-500")}>
            {formatWorkZoneDateKey(date, {
              weekday: "short",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "text-[10px] font-semibold px-2 py-0.5 rounded-full",
            occurrence === "upcoming" && "bg-amber-50 text-amber-700",
            occurrence === "today" && "bg-amber-100 text-amber-800",
            isPast && "bg-gray-200/80 text-gray-500",
          )}
        >
          {STATUS_LABEL[occurrence]}
        </span>
        {actions}
      </div>
    </div>
  );
}
