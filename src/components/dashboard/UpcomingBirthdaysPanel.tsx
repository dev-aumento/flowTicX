import { useMemo } from "react";
import { Cake, CalendarDays } from "lucide-react";
import { useNavigate } from "react-router";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { HolidayVisualBadge } from "@/components/leaves/HolidayVisualBadge";
import { holidayVisualForName } from "@/lib/holiday-icons";
import { trpc } from "@/providers/trpc";
import {
  formatWorkZoneDateKey,
  workZoneDateKey,
  workZoneWeekday,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";

const BIRTHDAY_BADGE = [
  { bg: "#DBEAFE", color: "#2563EB" },
  { bg: "#D1FAE5", color: "#059669" },
  { bg: "#EDE9FE", color: "#7C3AED" },
  { bg: "#FFEDD5", color: "#EA580C" },
];

export type UpcomingBirthdayItem = {
  id: number;
  name: string;
  avatar: string | null;
  position: string;
  dateLabel: string;
  daysLeft: number;
  isToday?: boolean;
};

function isBirthdayToday(person: UpcomingBirthdayItem) {
  return person.isToday === true || person.daysLeft === 0;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Sunday–Saturday week in IST (e.g. 15 Aug Saturday → 9 Aug–15 Aug). */
function sundaySaturdayWeek(now = new Date()) {
  const todayKey = workZoneDateKey(now);
  const weekday = workZoneWeekday(now);
  return {
    todayKey,
    weekStartKey: addDaysToDateKey(todayKey, -weekday),
    weekEndKey: addDaysToDateKey(todayKey, 6 - weekday),
  };
}

function birthdayLabel(names: string[]) {
  if (names.length === 1) return `Happy Birthday, ${names[0]}!`;
  if (names.length === 2) return `Happy Birthday, ${names[0]} and ${names[1]}!`;
  return `Happy Birthday to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}!`;
}

export function TodayBirthdaysBanner({
  birthdays,
  className = "",
}: {
  birthdays: UpcomingBirthdayItem[];
  className?: string;
}) {
  const todayBirthdays = birthdays.filter(isBirthdayToday);
  const { data: holidaysData } = trpc.leave.listHolidays.useQuery(undefined, {
    staleTime: 60_000,
  });

  const weekHolidays = useMemo(() => {
    const { todayKey, weekStartKey, weekEndKey } = sundaySaturdayWeek();
    return (holidaysData?.holidays ?? [])
      .filter((h) => h.date >= weekStartKey && h.date <= weekEndKey)
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
      .map((h) => ({
        ...h,
        isToday: h.date === todayKey,
      }));
  }, [holidaysData]);

  if (todayBirthdays.length === 0 && weekHolidays.length === 0) return null;

  const showBoth = todayBirthdays.length > 0 && weekHolidays.length > 0;
  const cardClass =
    "flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 min-w-0 dark:!border-emerald-800/70 dark:!bg-emerald-950/40";

  return (
    <div
      className={cn(
        "grid gap-3",
        showBoth && "grid-cols-1 md:grid-cols-2",
        className,
      )}
    >
      {todayBirthdays.length > 0 ? (
        <div className={cardClass}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shrink-0 dark:bg-emerald-900/80 dark:text-emerald-300">
            <Cake size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-800 truncate dark:text-emerald-200">
              {birthdayLabel(todayBirthdays.map((person) => person.name))}
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Celebrating with the team today
            </p>
          </div>
        </div>
      ) : null}

      {weekHolidays.length > 0 ? (
        <div className={cardClass}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shrink-0 dark:bg-emerald-900/80 dark:text-emerald-300">
            <CalendarDays size={18} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            {weekHolidays.map((holiday) => {
              const visual = holidayVisualForName(holiday.name, holiday.date);
              return (
                <div key={`${holiday.id}-${holiday.date}`} className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <HolidayVisualBadge
                      visual={visual}
                      flagClassName="h-3.5 w-[21px]"
                    />
                    <p className="text-sm font-semibold text-emerald-800 truncate dark:text-emerald-200 min-w-0">
                      {holiday.name}
                      {holiday.isToday ? (
                        <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-200 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-100">
                          Today
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    {holiday.isToday
                      ? "Public holiday · office closed today"
                      : `Public holiday this week · ${formatWorkZoneDateKey(holiday.date, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function UpcomingBirthdaysPanel({
  birthdays,
  className = "",
  showViewAll = true,
  variant = "light",
}: {
  birthdays: UpcomingBirthdayItem[];
  className?: string;
  showViewAll?: boolean;
  variant?: "light" | "dark";
}) {
  const navigate = useNavigate();
  const todayCount = birthdays.filter(isBirthdayToday).length;
  const dark = variant === "dark";
  const darkBadges = [
    { bg: "rgba(59,130,246,0.15)", color: "#60A5FA" },
    { bg: "rgba(16,185,129,0.15)", color: "#34D399" },
    { bg: "rgba(139,92,246,0.15)", color: "#A78BFA" },
    { bg: "rgba(249,115,22,0.15)", color: "#FB923C" },
  ];

  return (
    <div
      className={cn(
        dark
          ? "rounded-2xl border border-[#1C2330] bg-[#12161E] p-5 flex flex-col h-full"
          : "bg-white border border-gray-200 rounded-xl p-5 flex flex-col h-full dark:rounded-2xl dark:border-[#30363d] dark:bg-[#161b22]",
        className,
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className={cn("font-semibold", dark ? "text-white" : "text-[#1F2937] dark:text-white")}>
          Upcoming Birthdays
        </h2>
      </div>
      <p className={cn("text-xs mb-4", dark ? "text-slate-500" : "text-gray-400 dark:text-slate-500")}>
        This month &amp; next month
        {todayCount > 0 ? (
          <span
            className={cn(
              "ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full",
              dark
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-emerald-100 text-emerald-700",
            )}
          >
            <Cake size={11} />
            {todayCount === 1 ? "1 today" : `${todayCount} today`}
          </span>
        ) : null}
      </p>

      <div className="flex-1 space-y-2 overflow-y-auto max-h-64 pr-1">
        {birthdays.length === 0 ? (
          <div className={cn("flex flex-col items-center justify-center py-8", dark ? "text-slate-500" : "text-gray-400")}>
            <Cake size={28} className="mb-2 opacity-40" />
            <p className="text-xs">No birthdays this month or next</p>
          </div>
        ) : (
          birthdays.map((person, i) => {
            const today = isBirthdayToday(person);
            const badge = today
              ? dark
                ? { bg: "rgba(16,185,129,0.15)", color: "#34D399" }
                : { bg: "#D1FAE5", color: "#047857" }
              : dark
                ? darkBadges[i % darkBadges.length]
                : BIRTHDAY_BADGE[i % BIRTHDAY_BADGE.length];
            return (
              <div
                key={person.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-1",
                  today &&
                    (dark
                      ? "bg-emerald-500/10 border border-emerald-500/20"
                      : "bg-emerald-50 border border-emerald-100"),
                )}
              >
                <UserAvatar name={person.name} avatar={person.avatar} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {today ? (
                      <Cake
                        size={14}
                        className={dark ? "text-emerald-400 shrink-0" : "text-emerald-600 shrink-0"}
                      />
                    ) : null}
                    <div
                      className={cn(
                        "text-sm font-medium truncate",
                        dark ? "text-white" : "text-[#1F2937] dark:text-white",
                      )}
                    >
                      {person.name}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "text-xs truncate",
                      today
                        ? dark
                          ? "text-emerald-400 font-medium"
                          : "text-emerald-600 font-medium"
                        : dark
                          ? "text-slate-500"
                          : "text-gray-400",
                    )}
                  >
                    {today
                      ? `Happy Birthday · ${person.dateLabel}`
                      : `${person.position} · ${person.dateLabel}`}
                  </div>
                </div>
                <span
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                  style={{ backgroundColor: badge.bg, color: badge.color }}
                >
                  {today
                    ? "Today"
                    : person.daysLeft === 1
                      ? "1 Day Left"
                      : `${person.daysLeft} Days Left`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
