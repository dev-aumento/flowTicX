import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { clientCanViewDueDate } from "@/lib/client-visibility";
import { useTaskChats } from "@/hooks/useTaskChats";
import { formatWorkZoneDate, formatWorkZoneDateTime } from "@/lib/timezone";
import {
  buildAccessibleTaskViewPath,
  parseActivityIdParam,
} from "@/lib/task-notification-link";
import { hasPermission } from "@/lib/permissions";
import { downloadFileFromBase64, formatFileSize, getTaskFileBadge } from "@/lib/task-files";
import { markTaskNotificationsReadInCache } from "@/lib/notification-list-cache";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "framer-motion";
import {
  CalendarDays,
  ClipboardCheck,
  Download,
  FileText,
  Flag,
  Loader2,
  MessageSquare,
  Paperclip,
  Users,
} from "lucide-react";

type TaskRow = {
  id: number;
  title: string;
  status: string;
  priority?: string | null;
  dueDate?: Date | string | null;
  project?: { id: number; name: string } | null;
  assignee?: { name: string | null } | null;
};

function useClientTaskLinks() {
  const { user } = useAuth();
  const canViewAll = hasPermission(user, "tasks.view_all");
  return {
    tasksPath: canViewAll ? "/admin/tasks" : "/tasks",
    href: (taskId: number, activityId?: number | null) =>
      buildAccessibleTaskViewPath(canViewAll, taskId, activityId),
  };
}

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  icon: typeof ClipboardCheck;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1E1F21] dark:text-white">{title}</h1>
        <p className="text-sm text-[#6D6E6F] mt-1">{description}</p>
      </div>
      {children}
    </div>
  );
}

function EmptyState({
  title,
  body,
  to,
  action,
}: {
  title: string;
  body: string;
  to: string;
  action: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-14 text-center dark:border-[#30363d] dark:bg-[#161b22]">
      <p className="font-semibold text-[#1F2937] dark:text-white">{title}</p>
      <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{body}</p>
      <Link
        to={to}
        className="inline-flex mt-4 h-9 px-3.5 items-center rounded-lg bg-[#F06A6A] text-white text-sm font-semibold hover:bg-[#E45C5C]"
      >
        {action}
      </Link>
    </div>
  );
}

function TaskRows({ tasks }: { tasks: TaskRow[] }) {
  const { user } = useAuth();
  const { href } = useClientTaskLinks();
  const showDueDate = clientCanViewDueDate(user);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden dark:border-[#30363d] dark:bg-[#161b22]">
      {tasks.map((task) => (
        <Link
          key={task.id}
          to={href(task.id)}
          className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#1F2937] dark:text-white truncate">{task.title}</p>
            <p className="text-xs text-gray-400 truncate">
              {task.project?.name ?? "No project"}
              {task.assignee?.name ? ` · ${task.assignee.name}` : ""}
              {showDueDate && task.dueDate ? ` · ${formatWorkZoneDate(task.dueDate)}` : ""}
            </p>
          </div>
          <span
            className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize",
              String(task.priority).toLowerCase() === "high" || String(task.priority).toLowerCase() === "urgent"
                ? "bg-red-50 text-red-600"
                : "bg-slate-100 text-slate-600",
            )}
          >
            {task.priority || "normal"}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function ClientApprovals() {
  const { tasksPath } = useClientTaskLinks();
  const { data, isLoading } = trpc.task.list.useQuery({ status: "review", limit: 100 });
  const tasks = (data?.tasks ?? []) as TaskRow[];

  return (
    <Shell
      title="Approvals"
      description="Tasks waiting in review. Open an item to approve, comment, or send it back."
      icon={ClipboardCheck}
    >
      {isLoading ? (
        <Loader2 className="animate-spin text-gray-400" />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="No pending approvals"
          body="When your team marks work as review, it will show up here."
          to={tasksPath}
          action="Go to all tasks"
        />
      ) : (
        <TaskRows tasks={tasks} />
      )}
    </Shell>
  );
}

export function ClientMilestones() {
  const { user } = useAuth();
  const { tasksPath } = useClientTaskLinks();
  const showDueDate = clientCanViewDueDate(user);
  const { data, isLoading } = trpc.task.list.useQuery({ limit: 200 }, { enabled: showDueDate });
  const tasks = ((data?.tasks ?? []) as TaskRow[])
    .filter((task) => task.dueDate && task.status !== "done")
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

  return (
    <Shell
      title="Milestones"
      description="Upcoming due dates across your projects."
      icon={Flag}
    >
      {!showDueDate ? (
        <EmptyState
          title="Due dates are hidden"
          body="Your workspace admin has not enabled due date visibility for this portal."
          to="/"
          action="Back to home"
        />
      ) : isLoading ? (
        <Loader2 className="animate-spin text-gray-400" />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="No milestones yet"
          body="Add due dates on tasks to track milestones and countdown to delivery."
          to={tasksPath}
          action="Create a task"
        />
      ) : (
        <TaskRows tasks={tasks} />
      )}
    </Shell>
  );
}

export function ClientFiles() {
  const { href, tasksPath } = useClientTaskLinks();
  const utils = trpc.useUtils();
  const { data: files = [], isLoading } = trpc.task.listWorkspaceFiles.useQuery();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  async function handleDownload(file: {
    id: number;
    fileName: string;
    mimeType: string;
  }) {
    setDownloadingId(file.id);
    try {
      const full = await utils.task.getAttachment.fetch({ id: file.id });
      if (!full?.dataBase64) return;
      downloadFileFromBase64(file.fileName, file.mimeType, full.dataBase64);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Shell
      title="Files & Documents"
      description="Files attached to work in this workspace."
      icon={FileText}
    >
      {isLoading ? (
        <Loader2 className="animate-spin text-gray-400" />
      ) : files.length === 0 ? (
        <EmptyState
          title="No files yet"
          body="Upload PDFs, images, and other documents on a task. They will appear here."
          to={tasksPath}
          action="Open tasks"
        />
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden dark:border-[#30363d] dark:bg-[#161b22]">
          {files.map((file) => {
            const badge = getTaskFileBadge(file.fileName, file.mimeType);
            return (
              <div
                key={file.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 dark:border-white/5"
              >
                <Paperclip size={16} className="text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{file.fileName}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {badge.label}
                    {file.fileSize ? ` · ${formatFileSize(file.fileSize)}` : ""}
                    {file.projectName ? ` · ${file.projectName}` : ""}
                    {file.createdAt ? ` · ${formatWorkZoneDate(file.createdAt)}` : ""}
                  </p>
                  <Link
                    to={href(file.taskId)}
                    className="text-xs text-[#2563EB] hover:underline truncate inline-block mt-0.5"
                  >
                    {file.taskTitle}
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDownload(file)}
                  disabled={downloadingId === file.id}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"
                  title="Download"
                >
                  {downloadingId === file.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

export function ClientMeetings() {
  const { href, tasksPath } = useClientTaskLinks();
  const { data: meetings = [], isLoading } = trpc.task.listWorkspaceMeetings.useQuery();

  return (
    <Shell
      title="Meetings"
      description="Events and meetings added to work in this workspace."
      icon={CalendarDays}
    >
      {isLoading ? (
        <Loader2 className="animate-spin text-gray-400" />
      ) : meetings.length === 0 ? (
        <EmptyState
          title="No meetings scheduled"
          body="Add an event or meeting from a task comment. It will show up here with its title and time."
          to={tasksPath}
          action="Open tasks"
        />
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden dark:border-[#30363d] dark:bg-[#161b22]">
          {meetings.map((meeting) => (
            <Link
              key={meeting.id}
              to={href(meeting.taskId, meeting.id)}
              className="flex items-start gap-3 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
            >
              <CalendarDays size={16} className="text-gray-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#1F2937] dark:text-white truncate">
                  {meeting.title}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {meeting.when || formatWorkZoneDateTime(meeting.createdAt)}
                  {meeting.createdByName ? ` · ${meeting.createdByName}` : ""}
                  {meeting.projectName ? ` · ${meeting.projectName}` : ""}
                </p>
                <p className="text-xs text-gray-400 truncate mt-0.5">{meeting.taskTitle}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}

export function ClientMessages() {
  const { tasksPath } = useClientTaskLinks();
  const [searchParams, setSearchParams] = useSearchParams();
  const { taskChats, isLoading } = useTaskChats();
  const [selectedTask, setSelectedTask] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const markTaskReadMutation = trpc.notification.markReadForTask.useMutation({
    onMutate: ({ taskId }) => {
      markTaskNotificationsReadInCache(utils, taskId);
    },
    onSettled: () => {
      void utils.notification.list.invalidate();
    },
  });

  const openTask = (id: number) => {
    markTaskReadMutation.mutate({ taskId: id });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("task", String(id));
      return next;
    });
  };

  const closeTask = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("task");
      next.delete("activity");
      return next;
    });
  };

  const clearActivityHighlight = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("activity");
      return next;
    }, { replace: true });
  };

  const highlightActivityId = useMemo(
    () => parseActivityIdParam(searchParams.get("activity")),
    [searchParams],
  );

  useEffect(() => {
    const taskParam = searchParams.get("task");
    const parsed = taskParam ? Number(taskParam) : NaN;
    setSelectedTask(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }, [searchParams]);

  return (
    <Shell
      title="Messages"
      description="Task conversations with your account team. Invite teammates from Team to collaborate."
      icon={MessageSquare}
    >
      {isLoading ? (
        <Loader2 className="animate-spin text-gray-400" />
      ) : taskChats.length === 0 ? (
        <EmptyState
          title="No messages yet"
          body="Comments on tasks appear here. Assign work to your team to start a thread."
          to={tasksPath}
          action="Open tasks"
        />
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden dark:border-[#30363d] dark:bg-[#161b22]">
          {taskChats.map((chat) => (
            <Link
              key={chat.taskId}
              to={`/client/messages?task=${chat.taskId}`}
              onClick={() => markTaskReadMutation.mutate({ taskId: chat.taskId })}
              className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
            >
              <MessageSquare size={16} className="text-gray-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{chat.title}</p>
                <p className="text-xs text-gray-400 truncate">
                  {chat.lastMessage || chat.assignee?.name || "Open conversation"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        <Users size={12} />
        Need someone new on a thread? Invite them from{" "}
        <Link to="/admin/employees" className="text-[#2563EB] hover:underline">
          Team
        </Link>
        .
      </p>
      <AnimatePresence>
        {selectedTask ? (
          <TaskDetailPanel
            taskId={selectedTask}
            highlightActivityId={highlightActivityId}
            onHighlightDone={clearActivityHighlight}
            onClose={closeTask}
            onTaskOpen={openTask}
          />
        ) : null}
      </AnimatePresence>
    </Shell>
  );
}
