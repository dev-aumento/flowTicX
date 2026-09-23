import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { TaskChatsList } from "@/components/tasks/TaskChatsList";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { useTaskChats } from "@/hooks/useTaskChats";
import { parseActivityIdParam } from "@/lib/task-notification-link";
import { markTaskNotificationsReadInCache } from "@/lib/notification-list-cache";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export default function TaskChats() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { taskChats, taskChatsCount, isLoading } = useTaskChats();
  const [selectedTask, setSelectedTask] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notification.list.invalidate();
    },
  });

  const markTaskReadMutation = trpc.notification.markReadForTask.useMutation({
    onMutate: ({ taskId }) => {
      markTaskNotificationsReadInCache(utils, taskId);
    },
    onSettled: () => {
      void utils.notification.list.invalidate();
    },
  });

  const markTaskAsRead = (taskId: number) => {
    markTaskReadMutation.mutate({ taskId });
  };

  const openTask = (id: number) => {
    markTaskAsRead(id);
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
    setSelectedTask(taskParam ? Number(taskParam) : null);
  }, [searchParams]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Task Chats</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Recent conversations across your tasks
          </p>
        </div>

        {taskChatsCount > 0 && (
          <button
            type="button"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            className="h-9 px-3 text-sm font-medium text-[#2563EB] hover:bg-blue-50 rounded-xl border border-transparent hover:border-blue-100 transition-colors flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            {markAllReadMutation.isPending && <Loader2 size={14} className="animate-spin" />}
            Mark all as read
          </button>
        )}
      </div>

      <TaskChatsList
        chats={taskChats}
        isLoading={isLoading}
        onTaskClick={openTask}
        onMarkAsRead={markTaskAsRead}
      />

      <AnimatePresence>
        {selectedTask && (
          <TaskDetailPanel
            taskId={selectedTask}
            highlightActivityId={highlightActivityId}
            onHighlightDone={clearActivityHighlight}
            onClose={closeTask}
            onTaskOpen={openTask}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
