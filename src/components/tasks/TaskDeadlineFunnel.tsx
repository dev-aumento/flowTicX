import { useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { formatDurationClock } from "@/lib/utils";
import {
  DEADLINE_COLUMNS,
  groupTasksByDeadline,
  formatDueLabel,
  weeksOverdue,
  trackedSecondsFromHours,
  deadlineColumnToTaskUpdate,
  type DeadlineColumnKey,
} from "@/lib/task-deadline";
import { Plus, Loader2, GripVertical } from "lucide-react";
import { motion } from "framer-motion";
import { EdgeScrollArea } from "@/components/shared/EdgeScrollArea";
import { invalidateProjectStats } from "@/lib/project-stats";

type FunnelTask = {
  id: number;
  title: string;
  status: string;
  dueDate?: string | Date | null;
  actualHours?: string | null;
  assignee?: { name: string | null; avatar?: string | null } | null;
};

interface TaskDeadlineFunnelProps {
  tasks: FunnelTask[];
  isLoading?: boolean;
  onTaskClick: (id: number) => void;
  onCreateClick?: () => void;
  emptyMessage?: string;
}

export function TaskDeadlineFunnel({
  tasks,
  isLoading,
  onTaskClick,
  onCreateClick,
  emptyMessage,
}: TaskDeadlineFunnelProps) {
  const [draggedTask, setDraggedTask] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<DeadlineColumnKey | null>(null);
  const didDragRef = useRef(false);

  const utils = trpc.useUtils();
  const updateMutation = trpc.task.update.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
      utils.dashboard.getStats.invalidate();
      invalidateProjectStats(utils);
    },
  });

  const grouped = useMemo(() => groupTasksByDeadline(tasks), [tasks]);

  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    e.stopPropagation();
    didDragRef.current = true;
    setDraggedTask(taskId);
  };

  const handleDragOver = (e: React.DragEvent, columnKey: DeadlineColumnKey) => {
    e.preventDefault();
    setDragOverColumn(columnKey);
  };

  const handleDrop = (e: React.DragEvent, columnKey: DeadlineColumnKey) => {
    e.preventDefault();
    if (draggedTask) {
      const patch = deadlineColumnToTaskUpdate(columnKey);
      updateMutation.mutate({
        id: draggedTask,
        dueDate: patch.dueDate,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.stage ? { stage: patch.stage } : {}),
      });
    }
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverColumn(null);
    requestAnimationFrame(() => {
      didDragRef.current = false;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (tasks.length === 0 && emptyMessage) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <p className="text-sm text-gray-500 max-w-md">{emptyMessage}</p>
      </div>
    );
  }

  const boardMinHeight = "min-h-[calc(100vh-15rem)]";

  return (
    <EdgeScrollArea className={boardMinHeight}>
      <div className={`flex gap-4 items-stretch w-max min-w-full pb-1 ${boardMinHeight}`}>
        {DEADLINE_COLUMNS.map((column) => {
          const columnTasks = grouped[column.key];
          const isDragOver = dragOverColumn === column.key;

          return (
            <div
              key={column.key}
              className={`flex flex-col w-[272px] shrink-0 h-full ${boardMinHeight} bg-gray-50/80 border-2 rounded-xl transition-colors ${
                isDragOver ? "border-[#2563EB]/40 bg-blue-50/50" : "border-dashed border-gray-200"
              }`}
              onDragOver={(e) => handleDragOver(e, column.key)}
              onDrop={(e) => handleDrop(e, column.key)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverColumn(null);
                }
              }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/60 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: column.accentColor }}
                  />
                  <span className="text-sm font-semibold text-[#1F2937] truncate">
                    {column.label}
                  </span>
                  <span className="bg-gray-200 text-gray-600 text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                    {columnTasks.length}
                  </span>
                </div>
                {onCreateClick && column.key !== "completed" && (
                  <button
                    type="button"
                    onClick={onCreateClick}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-[#2563EB] hover:bg-gray-100 transition-colors shrink-0"
                    aria-label={`Add task to ${column.label}`}
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>

              <div className="flex-1 flex flex-col p-3 min-h-0">
                <div className="flex-1 space-y-2.5">
                  {columnTasks.map((task, i) => (
                    <DeadlineCard
                      key={task.id}
                      task={task}
                      columnKey={column.key}
                      index={i}
                      isDragging={draggedTask === task.id}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => {
                        if (!didDragRef.current) onTaskClick(task.id);
                      }}
                    />
                  ))}

                  {columnTasks.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-8 px-2">
                      {isDragOver ? "Drop here" : "No tasks"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </EdgeScrollArea>
  );
}

function DeadlineCard({
  task,
  columnKey,
  index,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  task: FunnelTask;
  columnKey: string;
  index: number;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const tracked = formatDurationClock(trackedSecondsFromHours(task.actualHours));
  const isCompleted = columnKey === "completed";
  const isOverdue = columnKey === "overdue";
  const isDueToday = columnKey === "due_today";

  const borderClass = isOverdue
    ? "border-red-500 hover:border-red-600 hover:shadow-md shadow-sm shadow-red-100"
    : isDueToday
      ? "border-amber-500 hover:border-amber-600 hover:shadow-md shadow-sm shadow-amber-100"
      : "border-gray-200 hover:shadow-md hover:border-gray-300";

  return (
    <motion.div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      onClick={onClick}
      className={`w-full text-left bg-white rounded-lg p-3.5 border-2 transition-all cursor-grab active:cursor-grabbing ${borderClass} ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        <GripVertical size={14} className="text-gray-300 mt-0.5 shrink-0 pointer-events-none" />
        <h4 className="text-sm font-medium text-[#1F2937] leading-snug line-clamp-2 flex-1">
          {task.title}
        </h4>
      </div>

      {task.assignee?.name && (
        <div className="flex items-center gap-2 mb-2">
          <UserAvatar name={task.assignee.name} avatar={task.assignee.avatar} size={22} />
          <span className="text-xs text-gray-600 truncate">{task.assignee.name}</span>
        </div>
      )}

      {isCompleted ? (
        <span className="inline-block mt-2 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
          Completed
        </span>
      ) : (
        <p
          className={`text-xs ${
            isOverdue
              ? "text-red-600 font-medium"
              : isDueToday
                ? "text-amber-600 font-medium"
                : task.dueDate
                  ? "text-gray-500"
                  : "text-gray-400"
          }`}
        >
          {task.dueDate ? formatDueLabel(task.dueDate) : "No deadline"}
        </p>
      )}

      {isOverdue && task.dueDate && (
        <span className="inline-block mt-2 text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
          − {weeksOverdue(task.dueDate)} week{weeksOverdue(task.dueDate) > 1 ? "s" : ""}
        </span>
      )}

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100 text-xs">
        <span className="text-gray-400">Time</span>
        <span className="font-mono font-medium text-gray-600 tabular-nums">
          {tracked}
        </span>
      </div>
    </motion.div>
  );
}
