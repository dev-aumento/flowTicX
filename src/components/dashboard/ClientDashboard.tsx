import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  dashboardQueryOptions,
  DASHBOARD_REFRESH_EVENT,
  refreshDashboardPage,
} from "@/lib/dashboard-refresh";
import { formatDueLabel, getDeadlineColumn, isTaskOverdue } from "@/lib/task-deadline";
import {
  formatWorkZoneDate,
  istTimeOfDayGreeting,
  workZoneDateParts,
  workZoneWallTimeToUtc,
  workZoneWeekday,
} from "@/lib/timezone";
import { formatMoney, formatOutstandingByCurrency, invoiceBalanceDue, invoiceStatusBadgeClass, invoiceStatusLabel, invoiceTotal, isInvoiceOutstanding } from "@/lib/invoice-store";
import { buildAllTasksViewPath, buildMyTasksViewPath } from "@/lib/task-notification-link";
import { canCreateProject as userCanCreateProject } from "@/lib/create-project-permission";
import { hasPermission } from "@/lib/permissions";
import { isClientPortalUser } from "@/lib/client-portal";
import { clientCanViewDueDate } from "@/lib/client-visibility";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { InviteUserDialog } from "@/components/admin/InviteUserDialog";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, Plus } from "lucide-react";

type TaskRow = {
  id: number;
  title: string;
  status: string;
  dueDate?: Date | string | null;
  assigneeId?: number | null;
  project?: { id: number; name: string; color?: string | null } | null;
  assignee?: { id?: number; name: string | null; avatar?: string | null } | null;
};

const PROJECT_DOTS = ["#F06A6A", "#F1BD6C", "#5DA283", "#4573D2", "#9A89C9", "#E362E3"];

type TaskTab = "upcoming" | "overdue" | "completed";
type PeoplePeriod = "week" | "month";

function isTaskDone(task: TaskRow) {
  return String(task.status ?? "").toLowerCase() === "done";
}

function dueTime(task: TaskRow) {
  if (!task.dueDate) return Number.POSITIVE_INFINITY;
  const due = new Date(task.dueDate);
  return Number.isNaN(due.getTime()) ? Number.POSITIVE_INFINITY : due.getTime();
}

function isDueSoon(task: TaskRow) {
  if (isTaskDone(task) || isTaskOverdue(task)) return false;
  const column = getDeadlineColumn(task);
  return column === "due_today" || column === "due_this_week";
}

function periodRange(period: PeoplePeriod) {
  const now = new Date();
  const { year, month, day } = workZoneDateParts(now);
  if (period === "month") {
    return {
      start: workZoneWallTimeToUtc(year, month, 1, 0, 0, 0, 0),
      end: workZoneWallTimeToUtc(year, month + 1, 0, 23, 59, 59, 999),
    };
  }
  const weekday = workZoneWeekday(now);
  return {
    start: workZoneWallTimeToUtc(year, month, day - weekday, 0, 0, 0, 0),
    end: workZoneWallTimeToUtc(year, month, day - weekday + 6, 23, 59, 59, 999),
  };
}

function dueInRange(task: TaskRow, start: Date, end: Date) {
  if (!task.dueDate) return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() >= start.getTime() && due.getTime() <= end.getTime();
}

function taskAssigneeId(task: TaskRow) {
  return task.assigneeId ?? task.assignee?.id ?? null;
}

function pillTabClass(active: boolean) {
  return active
    ? "h-7 px-2.5 rounded-full bg-[#E8E5E1] text-[12px] font-semibold text-[#1E1F21] dark:bg-[#3A3B3E] dark:text-[#F5F4F3]"
    : "h-7 px-2.5 rounded-full text-[12px] font-medium text-[#6D6E6F] hover:bg-[#F6F4F2] dark:text-[#A2A0A0] dark:hover:bg-white/5";
}

function Widget({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white border border-[#EDEAE6] shadow-[0_1px_2px_rgba(30,31,33,0.04)] p-5 h-full dark:bg-[#2A2B2D] dark:border-[#3D3E40]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[15px] font-semibold text-[#1E1F21] dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ClientDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const firstName = (user?.name || "there").split(" ")[0];
  const canManageInvoices = hasPermission(user, "invoices.manage");
  const myTasksPath = hasPermission(user, "tasks.view_all") ? "/admin/tasks" : "/tasks";
  const [taskTab, setTaskTab] = useState<TaskTab>("upcoming");
  const [peoplePeriod, setPeoplePeriod] = useState<PeoplePeriod>("week");
  const [inviteOpen, setInviteOpen] = useState(false);
  const canCreateProject = userCanCreateProject(user);
  const showDueDate = clientCanViewDueDate(user);

  const { data: projects, isLoading: projectsLoading } = trpc.project.list.useQuery(
    undefined,
    dashboardQueryOptions,
  );
  const { data: taskData, isLoading: tasksLoading } = trpc.task.list.useQuery(
    { limit: 200 },
    dashboardQueryOptions,
  );
  const { data: invoices = [] } = trpc.invoice.list.useQuery(undefined, {
    ...dashboardQueryOptions,
    enabled: isClientPortalUser(user) || canManageInvoices,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const { data: usersData } = trpc.user.listForPicker.useQuery({ limit: 200 }, dashboardQueryOptions);

  useEffect(() => {
    const onRefresh = () => void refreshDashboardPage(utils);
    window.addEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
  }, [utils]);

  useEffect(() => {
    if (!showDueDate && taskTab === "overdue") setTaskTab("upcoming");
  }, [showDueDate, taskTab]);

  const tasks = (taskData?.tasks ?? []) as TaskRow[];
  const team = usersData?.users ?? [];
  const upcomingTasks = useMemo(
    () =>
      tasks
        .filter((task) => !isTaskDone(task) && !isTaskOverdue(task))
        .sort((a, b) => dueTime(a) - dueTime(b)),
    [tasks],
  );
  const overdueTasks = useMemo(
    () =>
      tasks
        .filter((task) => !isTaskDone(task) && isTaskOverdue(task))
        .sort((a, b) => dueTime(a) - dueTime(b)),
    [tasks],
  );
  const completedTasks = useMemo(
    () => tasks.filter((task) => isTaskDone(task)),
    [tasks],
  );
  const taskGroups: Record<TaskTab, TaskRow[]> = {
    upcoming: upcomingTasks,
    overdue: overdueTasks,
    completed: completedTasks,
  };
  const visibleTasks = taskGroups[taskTab];
  const shownTasks = visibleTasks.slice(0, 8);
  const overdueCount = overdueTasks.length;
  const { start: periodStart, end: periodEnd } = periodRange(peoplePeriod);
  const people = useMemo(() => {
    const collaborators = team.filter((member) => member.id !== user?.id);
    const list = collaborators.length > 0 ? collaborators : team;
    return list.map((member) => {
      const assigned = tasks.filter((task) => taskAssigneeId(task) === member.id);
      const overdue = assigned.filter((task) => !isTaskDone(task) && isTaskOverdue(task)).length;
      const completed = assigned.filter(
        (task) => isTaskDone(task) && (!task.dueDate || dueInRange(task, periodStart, periodEnd)),
      ).length;
      const upcoming = assigned.filter((task) => {
        if (isTaskDone(task) || isTaskOverdue(task)) return false;
        return !task.dueDate || dueInRange(task, periodStart, periodEnd);
      }).length;
      return { member, overdue, completed, upcoming };
    });
  }, [periodEnd, periodStart, tasks, team, user?.id]);
  const dashboardProjects = useMemo(() => {
    const list = [...(projects ?? [])];
    list.sort((a, b) => {
      const aArchived = String(a.status ?? "").toLowerCase() === "archived" ? 1 : 0;
      const bArchived = String(b.status ?? "").toLowerCase() === "archived" ? 1 : 0;
      return aArchived - bArchived;
    });
    return list;
  }, [projects]);
  const approvals = tasks.filter((task) => task.status === "review").length;
  const unpaid = invoices.filter((invoice) => isInvoiceOutstanding(invoice.status));
  const unpaidTotalLabel = formatOutstandingByCurrency(unpaid);
  const loading = projectsLoading || tasksLoading;

  const greeting = useMemo(() => istTimeOfDayGreeting(), []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full md:w-[80%] mx-auto space-y-6"
    >
      <div>
        <p className="text-sm text-[#6D6E6F]">{formatWorkZoneDate(new Date(), { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="text-2xl sm:text-[28px] leading-tight font-semibold tracking-tight text-[#1E1F21] dark:text-white mt-1">
          {greeting}, {firstName}
        </h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/client/reports"
          className="h-8 px-3 flex items-center justify-center rounded-full bg-white border border-[#E8E5E1] text-[13px] text-[#3E3F42] hover:bg-[#EDEAE6] dark:bg-[#2A2B2D] dark:border-[#3D3E40] dark:text-[#C8C7C5]"
        >
          Reports & analytics
        </Link>
        {approvals > 0 ? (
          <Link
            to="/client/approvals"
            className="h-8 px-3 flex items-center justify-center rounded-full bg-white border border-[#E8E5E1] text-[13px] text-[#3E3F42] hover:bg-[#EDEAE6] dark:bg-[#2A2B2D] dark:border-[#3D3E40] dark:text-[#C8C7C5]"
          >
            {approvals} awaiting approval
          </Link>
        ) : null}
        {unpaid.length > 0 ? (
          <Link
            to="/client/invoices"
            className="h-8 px-3 flex items-center justify-center rounded-full bg-white border border-[#E8E5E1] text-[13px] text-[#3E3F42] hover:bg-[#EDEAE6] dark:bg-[#2A2B2D] dark:border-[#3D3E40] dark:text-[#C8C7C5]"
          >
            {unpaid.length} unpaid{unpaidTotalLabel ? ` · ${unpaidTotalLabel}` : ""}
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-[#6D6E6F]">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Widget title="My tasks">
            <div className="flex items-center gap-1 mb-3 -mt-1">
              {(
                (
                  [
                    { id: "upcoming" as const, label: "Upcoming" },
                    ...(showDueDate
                      ? [
                          {
                            id: "overdue" as const,
                            label:
                              overdueCount > 0
                                ? `Overdue (${overdueCount > 99 ? "99+" : overdueCount})`
                                : "Overdue",
                          },
                        ]
                      : []),
                    { id: "completed" as const, label: "Completed" },
                  ] as const
                )
              ).map((tab) => {
                const active = taskTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTaskTab(tab.id)}
                    className={pillTabClass(active)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="max-h-[280px] overflow-y-auto space-y-0.5">
              {shownTasks.map((task) => {
                const overdue = isTaskOverdue(task);
                const projectColor = task.project?.color || PROJECT_DOTS[0];
                return (
                  <Link
                    key={task.id}
                    to={
                      myTasksPath === "/admin/tasks"
                        ? buildAllTasksViewPath(task.id)
                        : buildMyTasksViewPath(task.id)
                    }
                    className="flex items-center gap-3 rounded-lg px-1.5 py-2 hover:bg-[#F6F4F2] dark:hover:bg-white/5"
                  >
                    <span
                      className={`h-[18px] w-[18px] rounded-full border-[1.5px] shrink-0 flex items-center justify-center ${
                        isTaskDone(task)
                          ? "border-[#5DA283] bg-[#5DA283]"
                          : "border-[#C8C7C5]"
                      }`}
                    >
                      {isTaskDone(task) ? <Check size={11} className="text-white" /> : null}
                    </span>
                    <span className="flex-1 min-w-0 text-[13px] text-[#1E1F21] dark:text-white truncate">
                      {task.title}
                    </span>
                    {task.project?.name ? (
                      <span className="flex items-center gap-1.5 min-w-0 max-w-[110px]">
                        <span
                          className="h-2 w-2 rounded-[2px] shrink-0"
                          style={{ background: projectColor }}
                        />
                        <span className="text-[11px] text-[#6D6E6F] truncate">{task.project.name}</span>
                      </span>
                    ) : null}
                    {showDueDate && task.dueDate ? (
                      <span
                        className={`text-[11px] shrink-0 tabular-nums ${
                          overdue ? "text-[#D65A4A]" : "text-[#6D6E6F]"
                        }`}
                      >
                        {formatDueLabel(task.dueDate, { month: "short", day: "numeric" })}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
              {shownTasks.length === 0 ? (
                <EmptyRow
                  text={
                    taskTab === "overdue"
                      ? "No overdue tasks."
                      : taskTab === "completed"
                        ? "No completed tasks yet."
                        : "Nothing upcoming. Create a task to get started."
                  }
                />
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 mt-2">
              {visibleTasks.length > shownTasks.length ? (
                <Link
                  to={myTasksPath}
                  className="text-[12px] font-medium text-[#6D6E6F] hover:text-[#1E1F21] px-1.5"
                >
                  Show more
                </Link>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() =>
                  navigate(myTasksPath.includes("?") ? myTasksPath : `${myTasksPath}?create=true`)
                }
                className="flex items-center gap-2 px-1.5 py-2 text-[13px] text-[#6D6E6F] hover:text-[#1E1F21] dark:hover:text-white"
              >
                <Plus size={14} /> Add task
              </button>
            </div>
          </Widget>

          <Widget
            title="Projects"
            action={
              <Link to="/projects" className="text-[12px] font-medium text-[#6D6E6F] hover:text-[#1E1F21] dark:hover:text-white">
                Browse projects
              </Link>
            }
          >
            <div className="max-h-[280px] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-0.5">
              {canCreateProject ? (
                <button
                  type="button"
                  onClick={() => navigate("/projects?create=1")}
                  className="flex items-center gap-2 rounded-xl border border-dashed border-[#D8D5D1] px-2 py-2 text-left hover:bg-[#F6F4F2] dark:border-[#4A4B4E] dark:hover:bg-white/5"
                >
                  <span className="h-7 w-7 rounded-md border border-dashed border-[#C8C7C5] flex items-center justify-center text-[#6D6E6F] dark:border-[#5A5B5E] shrink-0">
                    <Plus size={14} />
                  </span>
                  <span className="text-[12px] font-medium text-[#1E1F21] dark:text-white">Create project</span>
                </button>
              ) : null}
              {dashboardProjects.map((project, index) => {
                const archived = String(project.status ?? "").toLowerCase() === "archived";
                const dueSoon = showDueDate
                  ? tasks.filter(
                      (task) => task.project?.id === project.id && isDueSoon(task),
                    ).length
                  : 0;
                const subtitle = archived
                  ? "Archived"
                  : dueSoon > 0
                    ? `${dueSoon} task${dueSoon === 1 ? "" : "s"} due soon`
                    : null;
                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[#F6F4F2] dark:hover:bg-white/5"
                  >
                    <span
                      className="h-7 w-7 rounded-md shrink-0"
                      style={{ background: project.color || PROJECT_DOTS[index % PROJECT_DOTS.length] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium text-[#1E1F21] dark:text-white truncate">
                        {project.name}
                      </span>
                      {subtitle ? (
                        <span className="block text-[11px] text-[#6D6E6F] truncate mt-0.5">{subtitle}</span>
                      ) : null}
                    </span>
                  </Link>
                );
              })}
            </div>
            {dashboardProjects.length === 0 && !canCreateProject ? (
              <EmptyRow text="Create a project to organize work with your team." />
            ) : null}
          </Widget>

          <div className="xl:col-span-2">
            <Widget
              title="Invoices"
              action={
                <Link
                  to="/client/invoices"
                  className="text-[12px] font-medium text-[#6D6E6F] hover:text-[#1E1F21] dark:hover:text-white"
                >
                  View all
                </Link>
              }
            >
              {invoices.length === 0 ? (
                <EmptyRow text="When this workspace bills you, invoices will appear here." />
              ) : (
                <div className="space-y-0.5">
                  {invoices.slice(0, 6).map((invoice) => (
                    <Link
                      key={invoice.id}
                      to={`/client/invoices/${invoice.id}`}
                      className="flex items-center gap-3 rounded-lg px-1.5 py-2 hover:bg-[#F6F4F2] dark:hover:bg-white/5"
                    >
                      <span className="flex-1 min-w-0 text-[13px] font-medium text-[#1E1F21] dark:text-white truncate">
                        {invoice.invoiceNumber}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${invoiceStatusBadgeClass(invoice.status)}`}
                      >
                        {invoiceStatusLabel(invoice.status)}
                      </span>
                      <span className="text-[13px] font-semibold text-[#1E1F21] dark:text-white shrink-0">
                        {formatMoney(
                          invoice.status === "paid"
                            ? invoiceTotal(invoice)
                            : invoiceBalanceDue(invoice),
                          invoice.currency,
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Widget>
          </div>

          <div className="xl:col-span-2">
            <Widget title="People">
              <div className="flex items-center gap-1 mb-3 -mt-1">
                {(
                  [
                    { id: "week" as const, label: "This week" },
                    { id: "month" as const, label: "This month" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPeoplePeriod(tab.id)}
                    className={pillTabClass(peoplePeriod === tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="max-h-[240px] overflow-y-auto space-y-0.5">
                {people.map(({ member, overdue, completed, upcoming }) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 px-1.5 py-1 rounded-lg"
                  >
                    <UserAvatar name={member.name || member.email} avatar={member.avatar} size={28} />
                    <p className="flex-1 min-w-0 text-[12px] font-medium text-[#1E1F21] dark:text-white truncate">
                      {member.name?.trim() || member.email || "Teammate"}
                    </p>
                    <p className="hidden sm:block text-[12px] shrink-0 tabular-nums">
                      {showDueDate ? (
                        <span className={overdue > 0 ? "text-[#D65A4A]" : "text-[#6D6E6F]"}>
                          {overdue} overdue
                        </span>
                      ) : null}
                      <span className="text-[#6D6E6F]"> {completed} completed</span>
                      <span className="text-[#6D6E6F]"> {upcoming} upcoming</span>
                    </p>
                  </div>
                ))}
                {people.length === 0 ? (
                  <EmptyRow text="Invite your delivery team so you can assign tasks." />
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="mt-2 inline-flex items-center gap-2 px-1.5 py-2 text-[13px] text-[#6D6E6F] hover:text-[#1E1F21] dark:hover:text-white"
              >
                <Plus size={14} /> Invite teammate
              </button>
            </Widget>
          </div>
        </div>
      )}

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        kind="employee"
        teammateLabel
      />
    </motion.div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-[13px] text-[#6D6E6F] px-1.5 py-6 text-center">{text}</p>;
}
