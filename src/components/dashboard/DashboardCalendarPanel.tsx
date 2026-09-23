import { useMemo, useState } from "react";
import {
  CalendarDays,
  Loader2,
  Plus,
  Trash2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import { trpc } from "@/providers/trpc";
import { workZoneDateKey, formatWorkZoneDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";

function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

function formatDisplayTime(time: string | null | undefined) {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time;
  const d = new Date();
  d.setHours(hh!, mm!, 0, 0);
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

type ReminderRow = {
  id: number;
  title: string;
  note: string | null;
  dateKey: string;
  time: string | null;
  color: string | null;
  userId?: number;
  createdByName?: string | null;
};

/**
 * Renders two sibling cards (Calendar + Events) so a parent CSS grid can
 * place them as separate columns alongside Work / Project overview.
 */
export function DashboardCalendarEventsBlocks({
  className = "",
  variant = "light",
  stacked = false,
}: {
  className?: string;
  variant?: "light" | "dark";
  stacked?: boolean;
}) {
  const utils = trpc.useUtils();
  const todayKey = useMemo(() => workZoneDateKey(new Date()), []);
  const [selected, setSelected] = useState<Date>(() => parseDateKey(todayKey));
  const [month, setMonth] = useState<Date>(() => parseDateKey(todayKey));
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [adding, setAdding] = useState(false);

  const selectedKey = workZoneDateKey(selected);
  const year = month.getFullYear();
  const monthNum = month.getMonth() + 1;

  const { data: monthReminders = [], isLoading } =
    trpc.dashboardReminder.listByMonth.useQuery(
      { year, month: monthNum },
      { staleTime: 15_000 },
    );

  const createMutation = trpc.dashboardReminder.create.useMutation({
    onSuccess: async () => {
      setTitle("");
      setTime("");
      setAdding(false);
      await utils.dashboardReminder.listByMonth.invalidate();
      toast.success("Reminder added");
    },
    onError: (err) => toast.error(err.message || "Could not add reminder"),
  });

  const removeMutation = trpc.dashboardReminder.remove.useMutation({
    onSuccess: async () => {
      await utils.dashboardReminder.listByMonth.invalidate();
    },
    onError: (err) => toast.error(err.message || "Could not delete reminder"),
  });

  const daysWithReminders = useMemo(() => {
    return new Set(monthReminders.map((r) => r.dateKey));
  }, [monthReminders]);

  const dayReminders = useMemo(
    () =>
      (monthReminders as ReminderRow[])
        .filter((r) => r.dateKey === selectedKey)
        .sort((a, b) => String(a.time ?? "").localeCompare(String(b.time ?? ""))),
    [monthReminders, selectedKey],
  );

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Enter a reminder title");
      return;
    }
    createMutation.mutate({
      title: trimmed,
      dateKey: selectedKey,
      time: time.trim() ? time.trim() : null,
      note: null,
    });
  };

  const isToday = selectedKey === todayKey;
  const dark = variant === "dark";
  const cardClass = cn(
    dark
      ? "rounded-2xl border border-[#1C2330] bg-[#12161E] p-5 flex flex-col min-h-[280px] h-full min-w-0 overflow-hidden"
      : "bg-white border border-gray-200 rounded-xl p-5 flex flex-col min-h-[320px] h-full min-w-0 overflow-hidden dark:rounded-2xl dark:border-[#30363d] dark:bg-[#161b22]",
    className,
  );

  const headingClass = dark
    ? "font-semibold text-white"
    : "font-semibold text-[#1F2937] dark:text-white";
  const mutedClass = dark ? "text-slate-500" : "text-gray-400 dark:text-slate-500";
  const addBtnClass = dark
    ? "inline-flex items-center gap-1 text-xs font-semibold text-[#60A5FA] hover:underline shrink-0"
    : "inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline shrink-0 dark:text-[#60A5FA]";

  const calendarBlock = (
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`${headingClass} flex items-center gap-2`}>
            <CalendarDays size={16} className={dark ? "text-[#60A5FA]" : "text-[#2563EB] dark:text-[#60A5FA]"} />
            Calendar
          </h2>
        </div>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={(day) => {
            if (day) setSelected(day);
          }}
          className={
            dark
              ? "w-full min-w-0 bg-transparent p-0 text-slate-200 [--cell-size:2rem]"
              : "w-full min-w-0 bg-transparent p-0 [--cell-size:2rem] dark:text-slate-200"
          }
          classNames={{
            months: "relative flex w-full flex-col",
            month: "flex w-full flex-col gap-2",
            month_caption:
              "relative flex h-8 w-full items-center justify-center px-8",
            nav: "absolute inset-x-0 top-0 z-10 flex h-8 w-full items-center justify-between",
            month_grid: "w-full table-fixed border-collapse",
            weekdays: "flex w-full",
            weekday: cn(
              "flex-1 text-center text-[10px] font-medium",
              dark ? "text-slate-500" : "text-muted-foreground dark:text-slate-500",
            ),
            week: "mt-0.5 flex w-full",
            day: "flex-1 p-0 text-center",
            day_button: "h-8 w-full min-w-0 p-0 font-normal",
            button_previous: cn(
              "pointer-events-auto z-20 size-7 p-0",
              dark ? "text-slate-300 hover:bg-white/5 hover:text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white",
            ),
            button_next: cn(
              "pointer-events-auto z-20 size-7 p-0",
              dark ? "text-slate-300 hover:bg-white/5 hover:text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white",
            ),
          }}
          modifiers={{
            hasReminder: (day) => daysWithReminders.has(workZoneDateKey(day)),
          }}
          modifiersClassNames={{
            hasReminder:
              "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:rounded-full after:bg-[#3B82F6]",
          }}
        />
      </div>
  );

  const eventsBlock = (
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-3">
          <div className="min-w-0">
            <h2 className={headingClass}>
              {isToday ? "Today's Events" : "Events"}
            </h2>
            <p className={cn("text-[11px] truncate", mutedClass)}>
              {formatWorkZoneDate(selected, {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className={addBtnClass}
          >
            <Plus size={14} />
            Add
          </button>
        </div>

        {adding ? (
          <div
            className={
              dark
                ? "mb-3 rounded-xl border border-[#1C2330] bg-[#0B0E14] p-3 space-y-2"
                : "mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2"
            }
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Call with Ben — Keratin"
              className={
                dark
                  ? "w-full h-9 rounded-lg border border-[#1C2330] bg-[#12161E] px-3 text-sm text-white outline-none focus:border-[#3B82F6]"
                  : "w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#2563EB]"
              }
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={
                  dark
                    ? "h-9 rounded-lg border border-[#1C2330] bg-[#12161E] px-2 text-sm text-white outline-none focus:border-[#3B82F6]"
                    : "h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-[#2563EB]"
                }
              />
              <button
                type="button"
                onClick={submit}
                disabled={createMutation.isPending}
                className="h-9 px-3 rounded-lg bg-[#2563EB] text-white text-sm font-semibold disabled:opacity-60"
              >
                {createMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  "Save"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setTitle("");
                  setTime("");
                }}
                className={cn("h-9 px-2 text-sm", mutedClass)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className={cn("animate-spin", dark ? "text-slate-600" : "text-gray-300")} size={22} />
            </div>
          ) : dayReminders.length === 0 ? (
            <p className={cn("text-xs text-center py-8", mutedClass)}>
              No events for this day. Click Add to create one.
            </p>
          ) : (
            dayReminders.map((item) => (
              <div
                key={item.id}
                className={
                  dark
                    ? "flex items-start gap-2.5 rounded-xl border border-[#1C2330] bg-[#0B0E14] px-3 py-2.5 group"
                    : "flex items-start gap-2.5 rounded-xl border border-gray-100 bg-white px-3 py-2.5 group dark:border-[#1C2330] dark:bg-[#0B0E14]"
                }
              >
                <span
                  className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color || "#2563EB" }}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium leading-snug", dark ? "text-white" : "text-[#1F2937] dark:text-white")}>
                    {item.title}
                  </p>
                  {item.time ? (
                    <p className={cn("mt-0.5 inline-flex items-center gap-1 text-[11px]", mutedClass)}>
                      <Clock size={11} />
                      {formatDisplayTime(item.time)}
                    </p>
                  ) : null}
                  {item.createdByName ? (
                    <p className={cn("mt-0.5 text-[11px]", mutedClass)}>
                      Added by {item.createdByName}
                    </p>
                  ) : null}
                  {item.note ? (
                    <p className={cn("mt-0.5 text-[11px] line-clamp-2", mutedClass)}>
                      {item.note}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => removeMutation.mutate({ id: item.id })}
                  className={
                    dark
                      ? "opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-opacity"
                      : "opacity-0 group-hover:opacity-100 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-opacity"
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
  );

  if (stacked) {
    return (
      <div className="flex min-w-0 flex-col gap-4 h-full">
        {calendarBlock}
        {eventsBlock}
      </div>
    );
  }

  return (
    <>
      {calendarBlock}
      {eventsBlock}
    </>
  );
}

/** @deprecated Prefer DashboardCalendarEventsBlocks for the 4-block layout. */
export function DashboardCalendarPanel({
  className = "",
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-5", className)}>
      <DashboardCalendarEventsBlocks />
    </div>
  );
}
