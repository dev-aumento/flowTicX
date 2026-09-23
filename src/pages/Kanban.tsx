import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { canCreateTask, tryOpenCreateTask } from "@/lib/create-task-permission";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { PriorityBadge } from "@/components/shared/StatusBadge";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { GripVertical, Plus, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { defaultTaskDeadlineIso, formatDueLabel } from "@/lib/task-deadline";
import { clientCanViewDueDate } from "@/lib/client-visibility";
import { useTaskStatusLabels } from "@/hooks/useTaskStatusLabels";
import type { TaskDbStatus } from "@/lib/task-status-labels";

const COLUMNS: { key: TaskDbStatus; color: string }[] = [
  { key: "todo", color: "#6B7280" },
  { key: "in_progress", color: "#2563EB" },
  { key: "review", color: "#D97706" },
  { key: "done", color: "#059669" },
];

export default function Kanban() {
  const { user } = useAuth();
  const statusLabels = useTaskStatusLabels();
  const showDueDate = clientCanViewDueDate(user);
  const canCreate = canCreateTask(user);
  const [draggedTask, setDraggedTask] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const didDragRef = useRef(false);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const utils = trpc.useUtils();
  const { data: taskData } = trpc.task.list.useQuery({ limit: 200 });

  const updateStatusMutation = trpc.task.updateStatus.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
      utils.dashboard.getStats.invalidate();
    },
  });

  const createMutation = trpc.task.create.useMutation({
    onSuccess: (data) => {
      if (showCreate && data) {
        updateStatusMutation.mutate({ id: data.id, status: showCreate as "todo" | "in_progress" | "review" | "done" });
      }
      utils.task.list.invalidate();
      setShowCreate(null);
      setNewTaskTitle("");
    },
  });

  const handleDragStart = (taskId: number) => {
    didDragRef.current = true;
    setDraggedTask(taskId);
  };

  const handleDragOver = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    setDragOverColumn(columnKey);
  };

  const handleDrop = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    if (draggedTask) {
      updateStatusMutation.mutate({ id: draggedTask, status: columnKey as "todo" | "in_progress" | "review" | "done" });
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

  const tasksByColumn = (columnKey: string) =>
    taskData?.tasks.filter((t) => t.status === columnKey) || [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-5 h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Kanban Board</h1>
          <p className="text-sm text-gray-500 mt-0.5">Drag and drop tasks between columns</p>
        </div>
        <div className="text-sm text-gray-500">
          {taskData?.tasks.length || 0} tasks total
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((column) => {
          const columnTasks = tasksByColumn(column.key);
          const isDragOver = dragOverColumn === column.key;

          return (
            <div
              key={column.key}
              className={`bg-gray-50/80 border-2 rounded-xl flex flex-col transition-colors ${
                isDragOver ? "border-[#0EA5E9]/40 bg-sky-50/50" : "border-dashed border-gray-200"
              }`}
              style={{ minHeight: 400 }}
              onDragOver={(e) => handleDragOver(e, column.key)}
              onDrop={(e) => handleDrop(e, column.key)}
              onDragLeave={() => setDragOverColumn(null)}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/60">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color }} />
                  <span className="text-sm font-semibold text-[#1F2937]">{statusLabels[column.key]}</span>
                  <span className="bg-gray-200 text-gray-600 text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                    {columnTasks.length}
                  </span>
                </div>
              </div>

              {/* Task Cards */}
              <div className="flex-1 p-3 space-y-2.5 overflow-y-auto scrollbar-thin" style={{ maxHeight: "calc(100vh - 280px)" }}>
                <AnimatePresence mode="popLayout">
                  {columnTasks.map((task) => (
                    <motion.div
                      key={task.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      draggable
                      onDragStart={() => handleDragStart(task.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => {
                        if (!didDragRef.current) setSelectedTask(task.id);
                      }}
                      className={`bg-white border border-gray-200 rounded-lg p-3.5 cursor-pointer hover:shadow-md transition-shadow ${
                        draggedTask === task.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <GripVertical size={14} className="text-gray-300 mt-0.5 flex-shrink-0" />
                        <span className="text-sm font-medium text-[#1F2937] leading-snug">{task.title}</span>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <PriorityBadge priority={task.priority as "low" | "medium" | "high" | "urgent"} size="sm" />
                      </div>

                      <div className="flex items-center justify-between">
                        {task.assignee ? (
                          <UserAvatar name={task.assignee.name} avatar={task.assignee.avatar} size={22} />
                        ) : (
                          <span className="text-[10px] text-gray-400">Unassigned</span>
                        )}
                        {showDueDate && task.dueDate && (
                          <span className="text-[10px] text-gray-400">
                            {formatDueLabel(task.dueDate, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Add Task */}
                {canCreate && (showCreate === column.key ? (
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <input
                      autoFocus
                      type="text"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newTaskTitle.trim()) {
                          createMutation.mutate({
                            title: newTaskTitle.trim(),
                            dueDate: defaultTaskDeadlineIso(),
                          });
                        }
                        if (e.key === "Escape") {
                          setShowCreate(null);
                          setNewTaskTitle("");
                        }
                      }}
                      placeholder="Task title..."
                      className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => newTaskTitle.trim() && createMutation.mutate({
                          title: newTaskTitle.trim(),
                          dueDate: defaultTaskDeadlineIso(),
                        })}
                        disabled={createMutation.isPending}
                        className="h-7 px-3 bg-[#0EA5E9] text-white rounded-md text-xs font-medium hover:bg-[#0284C7]"
                      >
                        {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : "Add"}
                      </button>
                      <button
                        onClick={() => { setShowCreate(null); setNewTaskTitle(""); }}
                        className="h-7 px-3 text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => tryOpenCreateTask(user, () => setShowCreate(column.key))}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <Plus size={14} /> Add Task
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedTask && (
          <TaskDetailPanel taskId={selectedTask} onClose={() => setSelectedTask(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
