import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { PriorityBadge, StatusBadge } from "@/components/shared/StatusBadge";
import {
  CreateTaskModal,
  createEmptyTaskForm,
  type CreateTaskFormData,
} from "@/components/tasks/CreateTaskModal";
import {
  canCreateTask,
  tryOpenCreateTask,
} from "@/lib/create-task-permission";
import { buildMyTasksViewPath } from "@/lib/task-notification-link";
import { submitCreateTask } from "@/lib/submit-create-task";
import { resetStagingMediaIds } from "@/lib/staged-task-media";
import { invalidateTaskQueries } from "@/lib/invalidate-on-notifications";
import { invalidateProjectStats } from "@/lib/project-stats";
import { richCommentPlainText } from "@/lib/rich-comment";
import {
  formatWorkZoneDate,
  workZoneDateKey,
  workZoneDateParts,
  workZoneWallTimeToUtc,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";

type PriorityTab = "all" | "high" | "medium" | "low";

const PRIORITY_TABS: { id: PriorityTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "high", label: "High Priority" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

function matchesPriorityTab(priority: string, tab: PriorityTab) {
  if (tab === "all") return true;
  if (tab === "high") return priority === "high" || priority === "urgent";
  return priority === tab;
}

function taskDescriptionPreview(description?: string | null) {
  if (!description?.trim()) return null;
  const plain = richCommentPlainText(description).trim();
  if (!plain) return null;
  return plain.length > 80 ? `${plain.slice(0, 80).trimEnd()}…` : plain;
}

function relativeDueLabel(dueDate: string | Date | null | undefined) {
  if (!dueDate) return null;
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;

  const dueKey = workZoneDateKey(d);
  const now = new Date();
  const todayKey = workZoneDateKey(now);
  if (dueKey === todayKey) return "Today";

  const { year, month, day } = workZoneDateParts(now);
  const tomorrowKey = workZoneDateKey(
    workZoneWallTimeToUtc(year, month, day + 1, 12),
  );
  if (dueKey === tomorrowKey) return "Tomorrow";

  const dueParts = workZoneDateParts(d);
  const todayParts = workZoneDateParts(now);
  const dueUtc = Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day);
  const todayUtc = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);
  const diffDays = Math.round((dueUtc - todayUtc) / 86_400_000);
  if (diffDays > 1 && diffDays <= 14) return `In ${diffDays} days`;
  if (diffDays < 0) {
    const overdue = Math.abs(diffDays);
    return overdue === 1 ? "1 day overdue" : `${overdue} days overdue`;
  }
  return null;
}

function formatDueDate(dueDate: string | Date | null | undefined) {
  if (!dueDate) return "—";
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return "—";
  return formatWorkZoneDate(d, { day: "numeric", month: "short", year: "numeric" });
}

export function DashboardMyTasksPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const userId = user?.id ?? 0;
  const [tab, setTab] = useState<PriorityTab>("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState<CreateTaskFormData>(() =>
    createEmptyTaskForm(),
  );
  const [isCreating, setIsCreating] = useState(false);

  const { data, isLoading } = trpc.task.list.useQuery(
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

  const tasks = data?.tasks ?? [];

  const counts = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    for (const task of tasks) {
      if (task.priority === "high" || task.priority === "urgent") high += 1;
      else if (task.priority === "medium") medium += 1;
      else if (task.priority === "low") low += 1;
    }
    return { all: tasks.length, high, medium, low };
  }, [tasks]);

  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((task) => matchesPriorityTab(task.priority, tab))
        .slice(0, 5),
    [tasks, tab],
  );

  const canCreate = canCreateTask(user);

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

  const badgeFor = (id: PriorityTab) => {
    if (id === "all") return null;
    const n = counts[id];
    if (!n) return null;
    const tone =
      id === "high"
        ? "bg-red-500 text-white"
        : id === "medium"
          ? "bg-orange-500 text-white"
          : "bg-emerald-500 text-white";
    return (
      <span
        className={cn(
          "ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold",
          tone,
        )}
      >
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col h-full min-h-[300px]">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2 shrink-0">
        <h2 className="text-sm font-semibold text-[#1F2937]">My Tasks</h2>
        <button
          type="button"
          onClick={() => navigate("/tasks")}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
        >
          View all tasks
          <ArrowRight size={12} />
        </button>
      </div>

      <div className="flex items-center gap-1 px-4 border-b border-gray-100 overflow-x-auto shrink-0">
        {PRIORITY_TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "relative shrink-0 px-2.5 py-2 text-xs font-medium transition-colors",
                active ? "text-[#2563EB] dark:text-[#58a6ff]" : "text-gray-500 hover:text-gray-700 dark:hover:text-slate-300",
              )}
            >
              <span className="inline-flex items-center">
                {item.label}
                {badgeFor(item.id)}
              </span>
              {active ? (
                <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-[#2563EB]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-gray-400" size={22} />
          </div>
        ) : visibleTasks.length === 0 ? (
          <p className="py-10 text-center text-xs text-gray-500">
            No tasks in this priority
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed min-w-[560px] text-left">
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[18%]" />
                <col className="w-[14%]" />
                <col className="w-[16%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-100 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2 font-semibold">Task</th>
                  <th className="px-2 py-2 font-semibold">Project</th>
                  <th className="px-2 py-2 font-semibold">Priority</th>
                  <th className="px-2 py-2 font-semibold">Due Date</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task) => {
                  const relative = relativeDueLabel(task.dueDate);
                  const description = taskDescriptionPreview(task.description);
                  return (
                    <tr
                      key={task.id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/80 cursor-pointer"
                      onClick={() => navigate(buildMyTasksViewPath(task.id))}
                    >
                      <td className="px-4 py-2.5 align-top max-w-0">
                        <p className="text-xs font-semibold text-[#1F2937] truncate">
                          {task.title}
                        </p>
                        {description ? (
                          <p className="mt-0.5 text-[11px] text-gray-400 truncate">
                            {description}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2.5 align-top max-w-0">
                        <p className="text-xs font-medium text-[#1F2937] truncate">
                          {task.project?.name || "—"}
                        </p>
                      </td>
                      <td className="px-2 py-2.5 align-top whitespace-nowrap">
                        <PriorityBadge priority={task.priority} size="sm" />
                      </td>
                      <td className="px-2 py-2.5 align-top whitespace-nowrap">
                        <p className="text-xs text-[#1F2937]">
                          {formatDueDate(task.dueDate)}
                        </p>
                        {relative ? (
                          <p
                            className={cn(
                              "text-[10px] mt-0.5",
                              relative.includes("overdue")
                                ? "text-red-500"
                                : "text-gray-400",
                            )}
                          >
                            {relative}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-nowrap">
                        <StatusBadge status={task.status} size="sm" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canCreate ? (
        <div className="border-t border-gray-100 px-4 py-2 flex justify-center shrink-0">
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
          >
            <Plus size={14} />
            Add New Task
          </button>
        </div>
      ) : null}

      {canCreate ? (
        <CreateTaskModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          formData={formData}
          onFormDataChange={setFormData}
          onSubmit={handleCreate}
          isSubmitting={isCreating}
          users={usersData?.users ?? []}
          projects={projectsData ?? []}
          tasks={tasks.map((t) => ({ id: t.id, title: t.title }))}
          currentUser={
            user
              ? { id: user.id, name: user.name, avatar: user.avatar }
              : null
          }
        />
      ) : null}
    </div>
  );
}
