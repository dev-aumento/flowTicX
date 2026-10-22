import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, CalendarDays, LayoutDashboard, Loader2, LogOut, Plus, Timer } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useTaskLiveTimer } from "@/hooks/useTaskLiveTimer";
import { workZoneDateKey, workZoneWallTimeToUtc, formatWorkZoneDateKey } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { getDefaultHomePath } from "@/lib/permissions";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { calendarDateValue, parseDateValue } from "@/components/time-tracking/WorktimeClockPicker";

const ACCENT = "#2563EB";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_TYPES = new Set([
  "Design",
  "Marketing",
  "Programming",
  "Project Management",
  "Admin",
  "Internal",
  "Meetings",
]);

function hourTypeFromNote(note: string | null | undefined) {
  if (!note) return null;
  const parts = note.split(" · ").map((part) => part.trim()).filter(Boolean);
  const selected = parts[parts.length - 1];
  return selected && HOUR_TYPES.has(selected) ? selected : null;
}

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Parse a 60-minute clock. 00:30 is 30 minutes, 01:30 is 1 hour 30 minutes. */
function parseClockToSeconds(raw: string): number | null {
  const match = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] == null ? 0 : Number(match[3]);
  if (minutes >= 60 || seconds >= 60) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function shiftDate(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return workZoneDateKey(workZoneWallTimeToUtc(year!, month!, day! + days, 12));
}

const CALENDAR_HOUR_PX = 64;

function CalendarTimesheet({
  weekDays,
  rows,
  weekTotal,
  today,
}: {
  weekDays: Array<{ date: string; totalSeconds: number }>;
  rows: Array<{
    projectId: number | null;
    projectName: string;
    taskId: number;
    title: string;
    hourType: string | null;
    days: number[];
  }>;
  weekTotal: number;
  today: string;
}) {
  if (weekDays.length !== 7) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="animate-spin text-[#9CA3AF]" />
      </div>
    );
  }

  const dayBlocks = weekDays.map((_, dayIndex) => {
    let cursor = 0;
    const blocks = rows.flatMap((row) => {
      const seconds = row.days[dayIndex] ?? 0;
      if (seconds <= 0) return [];
      const hours = seconds / 3600;
      const block = {
        key: `${row.projectId ?? "none"}-${row.taskId}-${row.hourType ?? ""}-${dayIndex}`,
        projectName: row.projectName,
        hourType: row.hourType,
        title: row.title,
        taskId: row.taskId,
        seconds,
        top: cursor,
        hours,
      };
      cursor += hours;
      return [block];
    });
    return blocks;
  });
  const usedHours = Math.max(0, ...dayBlocks.map((blocks) => blocks.reduce((sum, block) => sum + block.hours, 0)));
  const hourCount = Math.max(8, Math.ceil(usedHours));
  const gridColumns = "3.25rem repeat(7, minmax(0,1fr)) 6.5rem";

  return (
    <div className="mt-6 overflow-x-auto">
      <div className="min-w-[920px]">
        <div className="grid border-b border-[#E5E7EB]" style={{ gridTemplateColumns: gridColumns }}>
          <div />
          {weekDays.map((day, index) => (
            <div key={day.date} className="border-l border-[#E5E7EB] px-2 py-2">
              <p className="text-sm text-[#6B7280]">
                {WEEKDAYS[index]}{" "}
                <span className={cn(day.date === today && "font-semibold")} style={day.date === today ? { color: ACCENT } : undefined}>
                  {formatWorkZoneDateKey(day.date, { day: "numeric" })}
                </span>
              </p>
              <p
                className="font-mono text-xs tabular-nums"
                style={{ color: day.totalSeconds > 0 || day.date === today ? ACCENT : "#9CA3AF" }}
              >
                {formatClock(day.totalSeconds)}
              </p>
            </div>
          ))}
          <div className="border-l border-[#E5E7EB] px-2 py-2 text-right">
            <p className="text-xs text-[#6B7280]">Week total</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{formatClock(weekTotal)}</p>
          </div>
        </div>

        <div className="max-h-[560px] overflow-y-auto">
          <div className="relative" style={{ height: hourCount * CALENDAR_HOUR_PX }}>
            <div className="grid h-full" style={{ gridTemplateColumns: gridColumns }}>
              <div className="relative">
                {Array.from({ length: hourCount }, (_, hour) => (
                  <span
                    key={hour}
                    className="absolute right-2 -translate-y-1/2 text-[11px] text-[#9CA3AF]"
                    style={{ top: (hour + 1) * CALENDAR_HOUR_PX }}
                  >
                    {hour + 1}hr
                  </span>
                ))}
              </div>
              {dayBlocks.map((blocks, dayIndex) => (
                <div key={weekDays[dayIndex]?.date ?? dayIndex} className="relative border-l border-[#E5E7EB]">
                  {Array.from({ length: hourCount }, (_, hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t border-[#F3F4F6]"
                      style={{ top: (hour + 1) * CALENDAR_HOUR_PX }}
                    />
                  ))}
                  {blocks.map((block) => (
                    <div
                      key={block.key}
                      className="absolute inset-x-1 overflow-hidden rounded-md px-2 py-1.5 text-white"
                      style={{
                        backgroundColor: ACCENT,
                        top: block.top * CALENDAR_HOUR_PX + 2,
                        height: Math.max(block.hours * CALENDAR_HOUR_PX - 4, 28),
                      }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="truncate text-xs font-semibold">{block.projectName}</p>
                        <span className="shrink-0 font-mono text-[11px]">{formatClock(block.seconds)}</span>
                      </div>
                      {block.hourType ? <p className="truncate text-xs">{block.hourType}</p> : null}
                      <Link to={`/tasks/task=${block.taskId}/`} className="block truncate text-xs underline underline-offset-2">
                        {block.title}
                      </Link>
                    </div>
                  ))}
                </div>
              ))}
              <div className="relative border-l border-[#E5E7EB]">
                {Array.from({ length: hourCount }, (_, hour) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-[#F3F4F6]"
                    style={{ top: (hour + 1) * CALENDAR_HOUR_PX }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectPulse() {
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const today = useMemo(() => workZoneDateKey(new Date()), []);
  const [date, setDate] = useState(today);
  const [view, setView] = useState<"day" | "week" | "calendar">("day");
  const [trackOpen, setTrackOpen] = useState(false);
  const [projectId, setProjectId] = useState<number | "">("");
  const [taskId, setTaskId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editHours, setEditHours] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => parseDateValue(today));

  const timesheet = trpc.task.getTimesheet.useQuery({ date }, { refetchInterval: 30_000 });
  const projects = trpc.project.listForPicker.useQuery();
  const tasks = trpc.task.list.useQuery(
    { projectId: typeof projectId === "number" ? projectId : undefined, limit: 100 },
    { enabled: typeof projectId === "number" },
  );

  const running = timesheet.data?.running ?? null;
  const live = useTaskLiveTimer(running ? { startedAt: running.startedAt, paused: false, accumulatedSeconds: 0 } : null);
  const weekTotal = (timesheet.data?.week ?? []).reduce((sum, day) => sum + day.totalSeconds, 0);

  const invalidate = () => {
    void utils.task.getTimesheet.invalidate();
    void utils.task.getMyActiveTimer.invalidate();
    void utils.task.getActiveTimer.invalidate();
    void utils.task.getTimeTracked.invalidate();
  };

  const startTimer = trpc.task.startTimer.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Timer started");
    },
    onError: (err) => toast.error(err.message || "Could not start the timer"),
  });
  const stopTimer = trpc.task.stopTimer.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Time saved");
    },
    onError: (err) => toast.error(err.message || "Could not stop the timer"),
  });
  const addTime = trpc.task.addManualTimeEntry.useMutation({
    onSuccess: () => {
      setHours("");
      setNote("");
      setTrackOpen(false);
      invalidate();
      toast.success("Time logged");
    },
    onError: (err) => toast.error(err.message || "Could not log time"),
  });
  const updateTime = trpc.task.updateTimeEntry.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidate();
      toast.success("Time updated");
    },
    onError: (err) => toast.error(err.message || "Could not update this entry"),
  });
  const deleteTime = trpc.task.deleteTimeEntry.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (err) => toast.error(err.message || "Could not delete this entry"),
  });

  const selectedTask = typeof taskId === "number" ? taskId : null;
  const dayLabel = formatWorkZoneDateKey(date, { weekday: "long", day: "numeric", month: "short" });
  const weekDays = timesheet.data?.week ?? [];
  const weekLabel = weekDays.length === 7
    ? `${formatWorkZoneDateKey(weekDays[0]!.date, { day: "numeric", month: "short" })} – ${formatWorkZoneDateKey(weekDays[6]!.date, { day: "numeric", month: "short", year: "numeric" })}`
    : dayLabel;

  function startTask(targetTaskId: number) {
    startTimer.mutate({ taskId: targetTaskId, clientStartedAt: new Date(), ledger: "projectpulse" });
  }

  function saveManual() {
    if (!selectedTask) {
      toast.error("Choose a project and a task first");
      return;
    }
    const durationSeconds = parseClockToSeconds(hours);
    if (!durationSeconds) {
      toast.error("Enter time like 00:30 or 01:30");
      return;
    }
    const [year, month, day] = date.split("-").map(Number);
    const clockIn = workZoneWallTimeToUtc(year!, month!, day!, 9, 0, 0, 0);
    const clockOut = new Date(clockIn.getTime() + durationSeconds * 1000);
    addTime.mutate({
      taskId: selectedTask,
      clockIn: clockIn.toISOString(),
      clockOut: clockOut.toISOString(),
      note: note.trim() || undefined,
      ledger: "projectpulse",
    });
  }

  function saveEdit(entry: { id: number; clockIn: Date | string }, taskEntryId: number) {
    const durationSeconds = parseClockToSeconds(editHours);
    if (!durationSeconds) {
      toast.error("Enter time like 00:30 or 01:30");
      return;
    }
    const clockIn = new Date(entry.clockIn);
    const clockOut = new Date(clockIn.getTime() + durationSeconds * 1000);
    updateTime.mutate({
      taskId: taskEntryId,
      entryId: entry.id,
      clockIn: clockIn.toISOString(),
      clockOut: clockOut.toISOString(),
      reason: "Edited in ProjectPulse",
    });
  }

  return (
    <div className="force-light flex min-h-screen bg-white text-[#1F2937]">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-[#E5E7EB] bg-[#F8FAFC] md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ backgroundColor: ACCENT }}>
            <Timer size={16} />
          </span>
          <span className="text-[15px] font-bold">ProjectPulse</span>
        </div>
        <nav className="px-3">
          <p className="rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ backgroundColor: ACCENT }}>
            Timesheet
          </p>
        </nav>
        <ul className="mt-auto space-y-1 border-t border-[#E5E7EB] px-3 py-4 text-sm">
          <li className="pb-1">
            <Link
              to="/settings"
              state={{ tab: "profile" }}
              title="Open profile settings"
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[#EEF2F7]"
            >
              <UserAvatar name={user?.name} avatar={user?.avatar} size={32} />
              <span className="min-w-0 truncate font-medium">{user?.name}</span>
            </Link>
          </li>
          <li>
            <Link
              to={getDefaultHomePath(user)}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[#4B5563] hover:bg-[#EEF2F7] hover:text-[#1F2937]"
            >
              <LayoutDashboard size={16} />
              Back to Dashboard
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => logout("/projectpulse/login")}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[#4B5563] hover:bg-[#EEF2F7] hover:text-[#1F2937]"
            >
              <LogOut size={16} />
              Log out
            </button>
          </li>
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-4 border-b border-[#E5E7EB] px-6 py-4">
          <h1 className="text-xl font-semibold">Timesheet</h1>
          <div className="flex rounded-lg border border-[#E5E7EB] p-0.5 text-sm">
            {(["day", "week", "calendar"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={cn(
                  "rounded-md px-3 py-1 capitalize",
                  view === item ? "font-semibold text-white" : "text-[#4B5563] hover:bg-[#F3F4F6]",
                )}
                style={view === item ? { backgroundColor: ACCENT } : undefined}
              >
                {item}
              </button>
            ))}
          </div>
        </header>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setTrackOpen((open) => !open)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-white"
              style={{ backgroundColor: ACCENT }}
            >
              <Plus size={16} />
              Track time
            </button>
            <Popover
              open={datePickerOpen}
              onOpenChange={(open) => {
                setDatePickerOpen(open);
                if (open) setPickerMonth(parseDateValue(date));
              }}
            >
              <div className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-1">
                <button type="button" onClick={() => setDate((value) => shiftDate(value, view === "day" ? -1 : -7))} className="grid h-8 w-8 place-items-center" aria-label="Previous">
                  <ChevronLeft size={16} />
                </button>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-8 items-center justify-center gap-1.5 px-1 text-sm font-medium",
                      view === "day" ? "min-w-[9.5rem]" : "min-w-[13.5rem]",
                    )}
                  >
                    <CalendarDays size={15} className="text-[#6B7280]" />
                    {view === "day" ? dayLabel : weekLabel}
                  </button>
                </PopoverTrigger>
                <button type="button" onClick={() => setDate((value) => shiftDate(value, view === "day" ? 1 : 7))} className="grid h-8 w-8 place-items-center" aria-label="Next">
                  <ChevronRight size={16} />
                </button>
              </div>
              <PopoverContent className="force-light w-[400px] p-0" align="start">
                <Calendar
                  mode="single"
                  weekStartsOn={1}
                  selected={parseDateValue(date)}
                  month={pickerMonth}
                  onMonthChange={setPickerMonth}
                  onSelect={(next) => {
                    if (!next) return;
                    setDate(calendarDateValue(next));
                    setDatePickerOpen(false);
                  }}
                  formatters={{
                    formatWeekdayName: (day) =>
                      day.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2),
                  }}
                  className="w-full p-4 [--cell-size:3rem]"
                  classNames={{
                    day_button:
                      "data-[selected-single=true]:bg-white data-[selected-single=true]:text-[#2563EB] data-[selected-single=true]:ring-2 data-[selected-single=true]:ring-inset data-[selected-single=true]:ring-[#2563EB]",
                  }}
                />
              </PopoverContent>
            </Popover>
            <button type="button" onClick={() => setDate(today)} className="text-sm font-medium" style={{ color: ACCENT }}>
              Return to today
            </button>
          </div>

          {trackOpen ? (
            <div className="mt-4 grid gap-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3 sm:grid-cols-[1.1fr_1.1fr_1fr_6.5rem_auto]">
              <select
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value ? Number(event.target.value) : "");
                  setTaskId("");
                }}
                className="h-10 rounded-md border border-[#E5E7EB] bg-white px-2 text-sm"
              >
                <option value="">Project</option>
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <select
                value={taskId}
                onChange={(event) => setTaskId(event.target.value ? Number(event.target.value) : "")}
                disabled={typeof projectId !== "number"}
                className="h-10 rounded-md border border-[#E5E7EB] bg-white px-2 text-sm disabled:opacity-50"
              >
                <option value="">Task</option>
                {(tasks.data?.tasks ?? []).map((task) => (
                  <option key={task.id} value={task.id}>{task.title}</option>
                ))}
              </select>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Notes"
                className="h-10 rounded-md border border-[#E5E7EB] bg-white px-3 text-sm"
              />
              <input
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                placeholder="00:30"
                aria-label="Time"
                inputMode="numeric"
                className="h-10 rounded-md border border-[#E5E7EB] bg-white px-2 text-right font-mono text-sm"
              />
              <button
                type="button"
                onClick={saveManual}
                disabled={addTime.isPending}
                className="h-10 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: ACCENT }}
              >
                {addTime.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null}

          {view === "calendar" ? (
            <CalendarTimesheet
              weekDays={weekDays}
              rows={timesheet.data?.weekRows ?? []}
              weekTotal={weekTotal}
              today={today}
            />
          ) : view === "week" ? (
            <div className="mt-6 overflow-x-auto">
              <div className="min-w-[920px]">
                <div className="grid grid-cols-[minmax(220px,1.5fr)_repeat(7,minmax(4.25rem,1fr))_5.25rem] items-end border-b border-[#E5E7EB] pb-3">
                  <div />
                  {weekDays.map((day, index) => (
                    <div key={day.date} className="text-center">
                      <span className="block text-xs text-[#6B7280]">{WEEKDAYS[index]}</span>
                      <span
                        className={cn("mt-1 block text-sm", day.date === today && "font-semibold")}
                        style={day.date === today ? { color: ACCENT } : undefined}
                      >
                        {formatWorkZoneDateKey(day.date, { day: "numeric" })}
                      </span>
                    </div>
                  ))}
                  <p className="text-right text-xs text-[#6B7280]">Total</p>
                </div>

                {timesheet.isLoading ? (
                  <div className="grid place-items-center py-16">
                    <Loader2 className="animate-spin text-[#9CA3AF]" />
                  </div>
                ) : (timesheet.data?.weekRows.length ?? 0) === 0 ? (
                  <p className="py-10 text-sm text-[#6B7280]">No time this week yet. Use Track time to add hours.</p>
                ) : (
                  timesheet.data?.weekRows.map((row) => (
                    <div
                      key={`${row.projectId ?? "none"}-${row.taskId}-${row.hourType ?? ""}`}
                      className="grid grid-cols-[minmax(220px,1.5fr)_repeat(7,minmax(4.25rem,1fr))_5.25rem] items-center border-b border-[#F3F4F6] py-3"
                    >
                      <div className="min-w-0 pr-4">
                        <p className="truncate text-sm font-semibold">{row.projectName}</p>
                        {row.hourType ? (
                          <p className="mt-0.5 truncate text-sm text-[#4B5563]">{row.hourType}</p>
                        ) : null}
                        <Link
                          to={`/tasks/task=${row.taskId}/`}
                          className="mt-0.5 block truncate text-sm underline underline-offset-2"
                          style={{ color: ACCENT }}
                        >
                          {row.title}
                        </Link>
                      </div>
                      {row.days.map((seconds, index) => (
                        <p
                          key={weekDays[index]?.date ?? index}
                          className="text-center font-mono text-sm tabular-nums"
                          style={{ color: seconds > 0 ? ACCENT : "#9CA3AF" }}
                        >
                          {formatClock(seconds)}
                        </p>
                      ))}
                      <p className="text-right font-mono text-sm font-semibold tabular-nums">
                        {formatClock(row.totalSeconds)}
                      </p>
                    </div>
                  ))
                )}

                <div className="grid grid-cols-[minmax(220px,1.5fr)_repeat(7,minmax(4.25rem,1fr))_5.25rem] items-center border-t border-[#E5E7EB] pt-3">
                  <button type="button" onClick={() => setTrackOpen(true)} className="text-left text-sm font-medium" style={{ color: ACCENT }}>
                    + Track time
                  </button>
                  {weekDays.map((day) => (
                    <p
                      key={day.date}
                      className="text-center font-mono text-sm font-semibold tabular-nums"
                      style={{ color: day.totalSeconds > 0 ? ACCENT : "#9CA3AF" }}
                    >
                      {formatClock(day.totalSeconds)}
                    </p>
                  ))}
                  <p className="text-right font-mono text-sm font-semibold tabular-nums">{formatClock(weekTotal)}</p>
                </div>
              </div>
            </div>
          ) : (
          <>
          <div className="mt-6 flex items-end border-b border-[#E5E7EB] pb-3">
            <div className={cn("grid min-w-0 flex-1 grid-cols-7 gap-2", view === "calendar" && "gap-3")}>
              {(timesheet.data?.week ?? []).map((day, index) => {
                const active = day.date === date;
                return (
                  <button key={day.date} type="button" onClick={() => { setDate(day.date); setView("day"); }} className="text-left">
                    <span className="block text-xs text-[#6B7280]">{WEEKDAYS[index]}</span>
                    <span className={cn("mt-1 block text-sm", active && "font-semibold")} style={active ? { color: ACCENT } : undefined}>
                      {formatWorkZoneDateKey(day.date, { day: "numeric" })}
                    </span>
                    <span
                      className="mt-1 block font-mono text-xs tabular-nums"
                      style={{ color: active || day.totalSeconds > 0 ? ACCENT : "#9CA3AF" }}
                    >
                      {formatClock(day.totalSeconds)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="w-[5.5rem] shrink-0 text-right">
              <p className="text-xs text-[#6B7280]">Week total</p>
              <p className="font-mono text-sm font-semibold tabular-nums">{formatClock(weekTotal)}</p>
            </div>
          </div>

          <div className="divide-y divide-[#F3F4F6]">
            {timesheet.isLoading ? (
              <div className="grid place-items-center py-16">
                <Loader2 className="animate-spin text-[#9CA3AF]" />
              </div>
            ) : (timesheet.data?.projects.length ?? 0) === 0 ? (
              <p className="py-10 text-sm text-[#6B7280]">No time on this day yet. Use Track time to add hours.</p>
            ) : (
              timesheet.data?.projects.map((project) => (
                <div key={project.projectId ?? "none"} className="py-2">
                  {project.tasks.map((task) =>
                    task.entries.map((entry) => {
                      const isRunning = entry.running;
                      const isEditing = editingId === entry.id;
                      const hourType = hourTypeFromNote(entry.note);
                      return (
                        <div key={entry.id} className="flex items-start py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{project.projectName}</p>
                            {hourType ? (
                              <p className="mt-0.5 truncate text-sm text-[#4B5563]">{hourType}</p>
                            ) : null}
                            <Link
                              to={`/tasks/task=${task.taskId}/`}
                              className="mt-0.5 block truncate text-sm underline underline-offset-2"
                              style={{ color: ACCENT }}
                            >
                              {task.title}
                            </Link>
                            {entry.mine ? null : (
                              <p className="mt-0.5 truncate text-xs text-[#6B7280]">by {entry.userName}</p>
                            )}
                            {isEditing ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <input
                                  value={editHours}
                                  onChange={(event) => setEditHours(event.target.value)}
                                  className="h-8 w-24 rounded-md border border-[#E5E7EB] px-2 text-right font-mono text-sm"
                                  aria-label="Edit time"
                                />
                                <button
                                  type="button"
                                  onClick={() => saveEdit(entry, task.taskId)}
                                  disabled={updateTime.isPending}
                                  className="h-8 rounded-md px-3 text-xs font-semibold text-white disabled:opacity-60"
                                  style={{ backgroundColor: ACCENT }}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteTime.mutate({ taskId: task.taskId, entryId: entry.id })}
                                  className="h-8 text-xs font-medium text-red-600"
                                >
                                  Delete
                                </button>
                                <button type="button" onClick={() => setEditingId(null)} className="h-8 text-xs text-[#6B7280]">
                                  Cancel
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <div className="flex w-48 shrink-0 items-center justify-end gap-2 pr-3">
                            {!entry.mine ? null : isRunning ? (
                              <button
                                type="button"
                                onClick={() => stopTimer.mutate({ taskId: task.taskId, ledger: "projectpulse" })}
                                disabled={stopTimer.isPending}
                                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#E5E7EB] px-3 text-sm font-medium disabled:opacity-60"
                              >
                                <Timer size={14} style={{ color: ACCENT }} />
                                Stop
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => startTask(task.taskId)}
                                disabled={startTimer.isPending}
                                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#E5E7EB] px-3 text-sm font-medium disabled:opacity-60"
                              >
                                <Timer size={14} style={{ color: ACCENT }} />
                                Start
                              </button>
                            )}
                            {isRunning || !entry.mine ? null : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(entry.id);
                                  setEditHours(formatClock(entry.durationSeconds));
                                }}
                                className="h-8 rounded-full border border-[#E5E7EB] px-3 text-sm font-medium"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          <p className="w-28 shrink-0 pt-1 text-right font-mono text-sm tabular-nums">
                            {isRunning ? formatClock(live.elapsedSeconds) : formatClock(entry.durationSeconds)}
                          </p>
                          <div className="w-[5.5rem] shrink-0" />
                        </div>
                      );
                    }),
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-2 flex items-center border-t border-[#E5E7EB] pt-3">
            <button type="button" onClick={() => setTrackOpen(true)} className="min-w-0 flex-1 text-left text-sm font-medium" style={{ color: ACCENT }}>
              + Track time
            </button>
            <p className="w-48 shrink-0 pr-3 text-right text-sm text-[#6B7280]">Total:</p>
            <p className="w-28 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
              {formatClock(timesheet.data?.totalSeconds ?? 0)}
            </p>
            <div className="w-[5.5rem] shrink-0" />
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
