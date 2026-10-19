import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router";
import { CalendarDays, ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLiveSessionTimers } from "@/hooks/useLiveSessionTimers";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { NotificationMenu } from "@/components/layout/NotificationMenu";
import { PlanExpiryNotice } from "@/components/billing/PlanExpiryNotice";
import {
  CreateTaskModal,
  createEmptyTaskForm,
  type CreateTaskFormData,
} from "@/components/tasks/CreateTaskModal";
import { canCreateTask, tryOpenCreateTask } from "@/lib/create-task-permission";
import { submitCreateTask } from "@/lib/submit-create-task";
import { resetStagingMediaIds } from "@/lib/staged-task-media";
import { invalidateTaskQueries } from "@/lib/invalidate-on-notifications";
import { invalidateProjectStats } from "@/lib/project-stats";
import { buildMyTasksViewPath } from "@/lib/task-notification-link";
import { canAccessRoute } from "@/lib/permissions";
import { dashboardQueryOptions, DASHBOARD_REFRESH_EVENT, refreshDashboardPage } from "@/lib/dashboard-refresh";
import {
  endOfWorkWeek,
  fillBreakdownForPeriod,
  startOfCalendarWeek,
  workedSecondsFromStats,
  type DailyHoursRow,
} from "@/lib/work-hours-policy";
import { formatWorkZoneDate, formatWorkZoneTime, istTimeOfDayGreeting } from "@/lib/timezone";
import { cn } from "@/lib/utils";

type StatusTab = "todo" | "in_progress" | "done";

const STATUS_TABS: { id: StatusTab; label: string }[] = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
];

const DAY_LETTERS = ["M", "T", "W", "T", "F"];

function statusBucket(status: string): StatusTab {
  if (status === "done") return "done";
  if (status === "in_progress" || status === "review") return "in_progress";
  return "todo";
}

function formatWeekTotal(totalSeconds: number) {
  const totalMinutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatRangeDate(date: Date) {
  return formatWorkZoneDate(date, { day: "numeric", month: "short", year: "numeric" });
}

function dueTimeLabel(dueDate: string | Date | null | undefined) {
  if (!dueDate) return null;
  const date = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(date.getTime())) return null;
  return formatWorkZoneTime(date, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function allTasksPathFor(user: ReturnType<typeof useAuth>["user"]) {
  if (canAccessRoute(user, "/admin/tasks")) return "/admin/tasks";
  if (canAccessRoute(user, "/tasks")) return "/tasks";
  return "/admin/tasks";
}

export function NativeHomeScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const userId = user?.id ?? 0;
  const [tab, setTab] = useState<StatusTab>("todo");
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [sheetTop, setSheetTop] = useState(12);
  const [peekOffset, setPeekOffset] = useState(320);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const sheetExpandedRef = useRef(false);
  const peekOffsetRef = useRef(320);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState<CreateTaskFormData>(() => createEmptyTaskForm());
  const [isCreating, setIsCreating] = useState(false);

  const greeting = useMemo(() => istTimeOfDayGreeting(new Date()), []);
  const firstName = user?.name?.split(" ")[0] || "there";
  const weekStart = useMemo(() => startOfCalendarWeek(new Date()), []);
  const weekEnd = useMemo(() => endOfWorkWeek(new Date()), []);
  const rangeLabel = `${formatRangeDate(weekStart)} - ${formatRangeDate(weekEnd)}`;
  const tasksPath = allTasksPathFor(user);

  const { data: weekStats } = trpc.timeEntry.getStats.useQuery(
    { period: "week" },
    { ...dashboardQueryOptions },
  );
  const { data: currentSession } = trpc.timeEntry.getCurrentSession.useQuery(undefined, {
    ...dashboardQueryOptions,
  });
  const { data: taskData, isLoading: tasksLoading } = trpc.task.list.useQuery(
    { assigneeId: userId, limit: 100 },
    { enabled: userId > 0, staleTime: 30_000 },
  );
  const { data: usersData } = trpc.user.listForPicker.useQuery(
    { limit: 500 },
    { enabled: showCreateModal },
  );
  const { data: projectsData } = trpc.project.listForPicker.useQuery(undefined, {
    enabled: showCreateModal,
  });

  const createMutation = trpc.task.create.useMutation();
  const addParticipantMutation = trpc.task.addParticipant.useMutation();
  const addObserverMutation = trpc.task.addObserver.useMutation();
  const updateMutation = trpc.task.update.useMutation();
  const createSubtaskMutation = trpc.subtask.create.useMutation();
  const addCommentMutation = trpc.task.addComment.useMutation();
  const addAttachmentMutation = trpc.task.addAttachment.useMutation();

  useEffect(() => {
    const onRefresh = () => {
      void refreshDashboardPage(utils);
      void utils.task.list.invalidate();
    };
    window.addEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
  }, [utils]);

  useEffect(() => {
    sheetExpandedRef.current = sheetExpanded;
  }, [sheetExpanded]);

  useEffect(() => {
    peekOffsetRef.current = peekOffset;
  }, [peekOffset]);

  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      const header = headerRef.current;
      if (!root || !header) return;
      const safeTop = Number.parseFloat(getComputedStyle(header).paddingTop) || 0;
      const top = Math.max(8, safeTop);
      const rootTop = root.getBoundingClientRect().top;
      const headerBottom = header.getBoundingClientRect().bottom;
      setSheetTop(top);
      setPeekOffset(Math.max(160, Math.round(headerBottom - rootTop - top)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (rootRef.current) observer.observe(rootRef.current);
    if (headerRef.current) observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);

  const sheetOffset = dragOffset ?? (sheetExpanded ? 0 : peekOffset);

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const startY = event.clientY;
    const startOffset = sheetExpandedRef.current ? 0 : peekOffsetRef.current;
    let dragged = false;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const move = (ev: PointerEvent) => {
      const delta = ev.clientY - startY;
      if (Math.abs(delta) > 8) dragged = true;
      const limit = peekOffsetRef.current;
      setDragOffset(Math.min(limit, Math.max(0, startOffset + delta)));
    };
    const up = (ev: PointerEvent) => {
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const delta = ev.clientY - startY;
      if (!dragged) {
        setSheetExpanded(!sheetExpandedRef.current);
      } else if (delta > 28) {
        setSheetExpanded(false);
      } else if (delta < -28) {
        setSheetExpanded(true);
      }
      setDragOffset(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const isClockedIn = !!currentSession?.active;
  const { workSeconds } = useLiveSessionTimers(isClockedIn ? currentSession : null);
  const weekTrackedSeconds = useMemo(
    () => workedSecondsFromStats(weekStats, workSeconds, isClockedIn),
    [weekStats, workSeconds, isClockedIn],
  );

  const weekDays = useMemo(() => {
    const filled = fillBreakdownForPeriod(weekStats?.dailyBreakdown ?? [], "week").slice(0, 5);
    const session = weekStats?.activeSession;
    if (!isClockedIn || !session) return filled;
    const deltaMinutes = (workSeconds - session.workSeconds) / 60;
    return filled.map((day) =>
      day.date === session.date
        ? { ...day, minutes: Math.max(0, day.minutes + deltaMinutes) }
        : day,
    );
  }, [weekStats, isClockedIn, workSeconds]);

  const tasks = taskData?.tasks ?? [];
  const counts = useMemo(() => {
    const next = { todo: 0, in_progress: 0, done: 0 };
    for (const task of tasks) next[statusBucket(task.status)] += 1;
    return next;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    return tasks
      .filter((task) => statusBucket(task.status) === tab)
      .slice()
      .sort((a, b) => {
        const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
  }, [tasks, tab]);

  const openCreate = () => {
    tryOpenCreateTask(user, () => {
      setFormData(createEmptyTaskForm());
      resetStagingMediaIds();
      setShowCreateModal(true);
    });
  };

  const handleCreate = async () => {
    if (!formData.title.trim()) return;
    setIsCreating(true);
    try {
      await submitCreateTask({
        formData,
        cloneSourceTitle: null,
        createMutation,
        addParticipantMutation,
        addObserverMutation,
        updateMutation,
        createSubtaskMutation,
        addCommentMutation,
        addAttachmentMutation,
      });
      setShowCreateModal(false);
      setFormData(createEmptyTaskForm());
      await invalidateTaskQueries(utils);
      invalidateProjectStats(utils);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden bg-black text-white">
      <div ref={headerRef} className="px-5 pb-5" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <PlanExpiryNotice />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate("/settings")}
            aria-label="Open menu"
            className="rounded-full"
          >
            <UserAvatar name={user?.name} avatar={user?.avatar} size={44} />
          </button>
          <NotificationMenu variant="native" />
        </div>

        <p className="mt-5 font-mono text-[13px] text-white/45">// New Day, New Tasks</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">
          {greeting}, {firstName}{" "}
          <span className="inline-block origin-[70%_70%] animate-wave" role="img" aria-label="waving hand">
            👋
          </span>
        </h1>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/time-tracking")}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-[#1C1C1E] px-3.5 py-3 text-left"
          >
            <CalendarDays size={16} className="shrink-0 text-white/70" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/90">{rangeLabel}</span>
            <ChevronDown size={16} className="shrink-0 text-white/45" />
          </button>
          <button
            type="button"
            onClick={openCreate}
            aria-label="Create task"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black"
          >
            <Plus size={22} strokeWidth={2.4} />
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Weekly Progress</h2>
          <button
            type="button"
            onClick={() => navigate("/time-tracking")}
            className="text-[13px] text-white/45"
          >
            View All
          </button>
        </div>
        <p className="mt-1 text-[22px] font-bold tracking-tight">{formatWeekTotal(weekTrackedSeconds)}</p>
        <WeekBars days={weekDays} />
      </div>

      <section
        className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[28px] bg-white text-[#111827] shadow-[0_-16px_40px_rgba(0,0,0,0.28)]"
        style={{
          top: sheetTop,
          transform: `translate3d(0, ${sheetOffset}px, 0)`,
          transition: dragOffset == null ? "transform 340ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        }}
      >
        <button
          type="button"
          onPointerDown={onHandlePointerDown}
          aria-expanded={sheetExpanded}
          aria-label={sheetExpanded ? "Collapse tasks" : "Expand tasks"}
          className="flex w-full shrink-0 touch-none cursor-grab justify-center pb-1 pt-3 active:cursor-grabbing"
        >
          <span className="h-1.5 w-10 rounded-full bg-black/15" />
        </button>
        <div className="flex items-center justify-between px-5 pb-3 pt-3">
          <h2 className="text-[20px] font-bold">All Tasks</h2>
          <button
            type="button"
            onClick={() => navigate(tasksPath)}
            className="inline-flex items-center gap-0.5 text-[14px] text-[#9AA3AF]"
          >
            See All
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto px-5 pb-3">
          {STATUS_TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold",
                  active ? "bg-black text-white" : "bg-[#EEF1F4] text-[#6B7280] dark:text-[#6B7280] dark:bg-[#1F2937]",
                )}
              >
                {item.label} ({counts[item.id]})
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pb-36">
          {tasksLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-[#9AA3AF]" size={22} />
            </div>
          ) : visibleTasks.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#9AA3AF]">No tasks in {STATUS_TABS.find((item) => item.id === tab)?.label}</p>
          ) : (
            visibleTasks.map((task) => {
              const time = dueTimeLabel(task.dueDate);
              const person = task.assignee ?? { name: user?.name, avatar: user?.avatar };
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => navigate(buildMyTasksViewPath(task.id))}
                  className="flex w-full items-center gap-3 rounded-2xl bg-[#F4F7FB] px-4 py-3.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-[#1A1A1A]">{task.title}</p>
                    {time ? <p className="mt-1 text-[13px] text-[#8B95A1]">{time}</p> : null}
                    <div className="mt-2">
                      <UserAvatar name={person?.name} avatar={person?.avatar} size={22} />
                    </div>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-[#C5CAD3]" />
                </button>
              );
            })
          )}
        </div>
      </section>

      {canCreateTask(user) ? (
        <CreateTaskModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          formData={formData}
          onFormDataChange={setFormData}
          onSubmit={handleCreate}
          isSubmitting={isCreating}
          users={usersData?.users ?? []}
          projects={projectsData ?? []}
          tasks={tasks.map((task) => ({ id: task.id, title: task.title }))}
          currentUser={user ? { id: user.id, name: user.name, avatar: user.avatar } : null}
        />
      ) : null}
    </div>
  );
}

function WeekBars({ days }: { days: DailyHoursRow[] }) {
  const maxMinutes = Math.max(...days.map((day) => day.minutes), 1);
  return (
    <div className="mt-4 flex items-end gap-3">
      {days.map((day, index) => {
        const empty = day.minutes <= 0;
        const height = empty ? 100 : Math.max(22, Math.round((day.minutes / maxMinutes) * 100));
        return (
          <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex h-28 w-full items-end">
              <div
                className={cn(
                  "w-full rounded-t-[14px]",
                  empty ? "native-week-empty h-full" : "bg-gradient-to-b from-[#7DD3FC] to-[#2563EB]",
                )}
                style={empty ? undefined : { height: `${height}%` }}
              />
            </div>
            <span className="text-[12px] font-medium text-white/40">{DAY_LETTERS[index] ?? ""}</span>
          </div>
        );
      })}
    </div>
  );
}
