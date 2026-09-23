import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CheckCircle2, CircleDot, FolderKanban, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { clientCanViewDueDate } from "@/lib/client-visibility";
import { isTaskOverdue } from "@/lib/task-deadline";
import { workZoneDateParts } from "@/lib/timezone";
import { FilterSelect } from "@/components/shared/FilterSelect";
import { hasPermission } from "@/lib/permissions";
import { buildMyTasksViewPath, buildAllTasksViewPath } from "@/lib/task-notification-link";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  todo: "#94A3B8",
  in_progress: "#4573D2",
  review: "#F1BD6C",
  done: "#5DA283",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

type ReportTask = {
  id: number;
  title: string;
  status: string;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  dueDate?: string | Date | null;
  projectId?: number | null;
  project?: { id: number; name: string; color?: string | null } | null;
};

function isDone(task: ReportTask) {
  return String(task.status ?? "").toLowerCase() === "done";
}

function toMonthKey(value?: Date | string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const { year, month } = workZoneDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function lastMonthKeys(count: number) {
  const { year, month } = workZoneDateParts(new Date());
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    let y = year;
    let m = month - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

function taskMatchesMonth(task: ReportTask, month: string) {
  return toMonthKey(task.createdAt) === month || (isDone(task) && toMonthKey(task.updatedAt) === month);
}

export default function ClientReports() {
  const { user } = useAuth();
  const showDueDate = clientCanViewDueDate(user);
  const tasksPath = hasPermission(user, "tasks.view_all") ? "/admin/tasks" : "/tasks";
  const taskLink = (id: number) =>
    hasPermission(user, "tasks.view_all") ? buildAllTasksViewPath(id) : buildMyTasksViewPath(id);

  const [projectId, setProjectId] = useState("");
  const [month, setMonth] = useState("");

  const { data: projects } = trpc.project.listForPicker.useQuery(undefined, { staleTime: 30_000 });
  const { data: taskData, isLoading } = trpc.task.list.useQuery({ limit: 500 });
  const tasks = (taskData?.tasks ?? []) as ReportTask[];

  const monthKeys = useMemo(() => lastMonthKeys(12), []);
  const projectOptions = useMemo(
    () => [
      { value: "", label: "All projects" },
      ...(projects ?? []).map((project) => ({
        value: String(project.id),
        label: project.name,
      })),
    ],
    [projects],
  );
  const monthOptions = useMemo(
    () => [
      { value: "", label: "All months" },
      ...monthKeys.map((key) => ({ value: key, label: monthLabel(key) })).reverse(),
    ],
    [monthKeys],
  );

  const selectedProjectId = projectId ? Number(projectId) : null;
  const selectedProjectName =
    projectOptions.find((option) => option.value === projectId)?.label ?? "All projects";

  const scopedTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (selectedProjectId != null) {
        const id = task.projectId ?? task.project?.id ?? null;
        if (id !== selectedProjectId) return false;
      }
      if (month && !taskMatchesMonth(task, month)) return false;
      return true;
    });
  }, [month, selectedProjectId, tasks]);

  const report = useMemo(() => {
    const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };
    let overdue = 0;
    let createdInMonth = 0;
    let completedInMonth = 0;

    for (const task of scopedTasks) {
      const status = String(task.status ?? "").toLowerCase();
      if (status in counts) counts[status as keyof typeof counts] += 1;
      if (showDueDate && isTaskOverdue(task)) overdue += 1;
      if (month) {
        if (toMonthKey(task.createdAt) === month) createdInMonth += 1;
        if (isDone(task) && toMonthKey(task.updatedAt) === month) completedInMonth += 1;
      }
    }

    const statusChart = (Object.keys(counts) as Array<keyof typeof counts>)
      .map((key) => ({
        name: STATUS_LABELS[key],
        key,
        value: counts[key],
        color: STATUS_COLORS[key],
      }))
      .filter((row) => row.value > 0);

    const byProjectMap = new Map<
      string,
      { name: string; color: string; total: number; done: number; open: number }
    >();
    for (const task of scopedTasks) {
      const id = String(task.projectId ?? task.project?.id ?? "none");
      const name = task.project?.name?.trim() || "No project";
      const color = task.project?.color || "#9A89C9";
      const existing = byProjectMap.get(id) ?? { name, color, total: 0, done: 0, open: 0 };
      existing.total += 1;
      if (isDone(task)) existing.done += 1;
      else existing.open += 1;
      byProjectMap.set(id, existing);
    }
    const byProject = [...byProjectMap.values()].sort((a, b) => b.total - a.total);

    const monthly = monthKeys.map((key) => {
      let created = 0;
      let completed = 0;
      for (const task of tasks) {
        if (selectedProjectId != null) {
          const id = task.projectId ?? task.project?.id ?? null;
          if (id !== selectedProjectId) continue;
        }
        if (toMonthKey(task.createdAt) === key) created += 1;
        if (isDone(task) && toMonthKey(task.updatedAt) === key) completed += 1;
      }
      const [year, monthNum] = key.split("-").map(Number);
      return {
        month: new Date(year, (monthNum || 1) - 1, 1).toLocaleDateString("en-IN", {
          month: "short",
          year: "2-digit",
        }),
        key,
        created,
        completed,
      };
    });

    const total = scopedTasks.length;
    const done = counts.done;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

    return {
      total,
      done,
      open: total - done,
      overdue,
      createdInMonth,
      completedInMonth,
      completionRate,
      statusChart,
      byProject,
      monthly,
      recent: [...scopedTasks]
        .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
        .slice(0, 8),
    };
  }, [month, monthKeys, scopedTasks, selectedProjectId, showDueDate, tasks]);

  const filterSummary = [
    selectedProjectName,
    month ? monthLabel(month) : "All months",
  ].join(" · ");

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-[#1E1F21] dark:text-white">
            Reports & analytics
          </h1>
          <p className="text-sm text-[#6D6E6F] mt-1">
            Filter by project or month to see how work is progressing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={projectId}
            onChange={setProjectId}
            options={projectOptions}
            aria-label="Filter by project"
            triggerClassName="min-w-[180px] h-9 border-[#E8E5E1] focus:ring-[#F06A6A]/20 focus:border-[#F06A6A]"
          />
          <FilterSelect
            value={month}
            onChange={setMonth}
            options={monthOptions}
            aria-label="Filter by month"
            triggerClassName="min-w-[160px] h-9 border-[#E8E5E1] focus:ring-[#F06A6A]/20 focus:border-[#F06A6A]"
          />
        </div>
      </div>

      <p className="text-xs font-medium text-[#6D6E6F]">{filterSummary}</p>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-[#6D6E6F]">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              label="Tasks"
              value={report.total}
              icon={FolderKanban}
            />
            <Kpi
              label="Completed"
              value={month ? report.completedInMonth : report.done}
              hint={month ? "Finished this month" : `${report.completionRate}% complete`}
              icon={CheckCircle2}
            />
            <Kpi
              label="Open"
              value={report.open}
              icon={CircleDot}
            />
            {showDueDate ? (
              <Kpi label="Overdue" value={report.overdue} tone={report.overdue > 0 ? "alert" : "default"} />
            ) : (
              <Kpi
                label={month ? "Created" : "Completion"}
                value={month ? report.createdInMonth : `${report.completionRate}%`}
                icon={BarChart3}
              />
            )}
          </div>

          {report.total === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8E5E1] bg-white py-14 text-center dark:border-[#3D3E40] dark:bg-[#2A2B2D]">
              <p className="font-semibold text-[#1E1F21] dark:text-white">No tasks in this view</p>
              <p className="text-sm text-[#6D6E6F] mt-1 max-w-md mx-auto">
                Try another project or month, or open tasks to add work.
              </p>
              <Link
                to={tasksPath}
                className="inline-flex mt-4 h-9 px-3.5 items-center rounded-lg bg-[#F06A6A] text-white text-sm font-semibold hover:bg-[#E45C5C]"
              >
                Go to tasks
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className="rounded-2xl bg-white border border-[#EDEAE6] p-5 dark:bg-[#2A2B2D] dark:border-[#3D3E40]">
                  <h2 className="text-[15px] font-semibold text-[#1E1F21] dark:text-white mb-4">
                    Task status
                  </h2>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={report.statusChart}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={78}
                          paddingAngle={3}
                        >
                          {report.statusChart.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap justify-center gap-3 mt-1">
                    {report.statusChart.map((entry) => (
                      <div key={entry.key} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-xs text-[#6D6E6F]">
                          {entry.name} ({entry.value})
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl bg-white border border-[#EDEAE6] p-5 dark:bg-[#2A2B2D] dark:border-[#3D3E40]">
                  <h2 className="text-[15px] font-semibold text-[#1E1F21] dark:text-white mb-1">
                    {selectedProjectId ? "Monthly activity" : "Work by project"}
                  </h2>
                  <p className="text-xs text-[#6D6E6F] mb-4">
                    {selectedProjectId
                      ? "Tasks created and completed by month"
                      : month
                        ? "How each project contributed this month"
                        : "Task volume across projects"}
                  </p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      {selectedProjectId ? (
                        <LineChart data={report.monthly}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E8E5E1" />
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }} />
                          <Line type="monotone" dataKey="created" stroke="#4573D2" strokeWidth={2} name="Created" dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="completed" stroke="#5DA283" strokeWidth={2} name="Completed" dot={{ r: 3 }} />
                        </LineChart>
                      ) : (
                        <BarChart data={report.byProject.slice(0, 8)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E8E5E1" />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} interval={0} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }} />
                          <Bar dataKey="open" stackId="a" fill="#4573D2" name="Open" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="done" stackId="a" fill="#5DA283" name="Done" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>

              {!selectedProjectId && !month ? (
                <section className="rounded-2xl bg-white border border-[#EDEAE6] p-5 dark:bg-[#2A2B2D] dark:border-[#3D3E40]">
                  <h2 className="text-[15px] font-semibold text-[#1E1F21] dark:text-white mb-1">
                    Month-wise trend
                  </h2>
                  <p className="text-xs text-[#6D6E6F] mb-4">Created vs completed across all projects</p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={report.monthly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8E5E1" />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }} />
                        <Line type="monotone" dataKey="created" stroke="#4573D2" strokeWidth={2} name="Created" dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="completed" stroke="#5DA283" strokeWidth={2} name="Completed" dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl bg-white border border-[#EDEAE6] overflow-hidden dark:bg-[#2A2B2D] dark:border-[#3D3E40]">
                <div className="px-5 py-4 border-b border-[#EDEAE6] dark:border-[#3D3E40]">
                  <h2 className="text-[15px] font-semibold text-[#1E1F21] dark:text-white">
                    {selectedProjectId ? "Recent tasks" : "Project summary"}
                  </h2>
                </div>
                {selectedProjectId ? (
                  <div className="divide-y divide-[#F3F1EE] dark:divide-[#3D3E40]">
                    {report.recent.map((task) => (
                      <Link
                        key={task.id}
                        to={taskLink(task.id)}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-[#F6F4F2] dark:hover:bg-white/5"
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: STATUS_COLORS[String(task.status).toLowerCase()] ?? "#94A3B8" }}
                        />
                        <span className="flex-1 text-sm text-[#1E1F21] truncate dark:text-white">{task.title}</span>
                        <span className="text-xs text-[#6D6E6F] capitalize">
                          {STATUS_LABELS[String(task.status).toLowerCase()] ?? task.status}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-[#6D6E6F] border-b border-[#EDEAE6] dark:border-[#3D3E40]">
                          <th className="px-5 py-2.5 font-medium">Project</th>
                          <th className="px-5 py-2.5 font-medium">Tasks</th>
                          <th className="px-5 py-2.5 font-medium">Open</th>
                          <th className="px-5 py-2.5 font-medium">Done</th>
                          <th className="px-5 py-2.5 font-medium">Complete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byProject.map((row) => (
                          <tr
                            key={row.name}
                            className="border-b border-[#F3F1EE] last:border-0 dark:border-[#3D3E40]"
                          >
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: row.color }} />
                                <span className="truncate font-medium text-[#1E1F21] dark:text-white">{row.name}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-[#3E3F42] dark:text-[#C8C7C5]">{row.total}</td>
                            <td className="px-5 py-3 text-[#3E3F42] dark:text-[#C8C7C5]">{row.open}</td>
                            <td className="px-5 py-3 text-[#3E3F42] dark:text-[#C8C7C5]">{row.done}</td>
                            <td className="px-5 py-3 text-[#3E3F42] dark:text-[#C8C7C5]">
                              {row.total > 0 ? `${Math.round((row.done / row.total) * 100)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon?: typeof BarChart3;
  tone?: "default" | "alert";
}) {
  return (
    <div className="rounded-2xl bg-white border border-[#EDEAE6] p-4 dark:bg-[#2A2B2D] dark:border-[#3D3E40]">
      <div className="flex items-center gap-2 mb-2">
        {Icon ? <Icon size={15} className="text-[#F06A6A]" /> : null}
        <span className="text-xs text-[#6D6E6F]">{label}</span>
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tracking-tight",
          tone === "alert" ? "text-red-600" : "text-[#1E1F21] dark:text-white",
        )}
      >
        {value}
      </div>
      {hint ? <p className="text-[11px] text-[#6D6E6F] mt-1">{hint}</p> : null}
    </div>
  );
}
