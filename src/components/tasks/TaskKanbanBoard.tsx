import { useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { EdgeScrollArea } from "@/components/shared/EdgeScrollArea";
import { formatKanbanDueLabel } from "@/lib/task-deadline";
import { invalidateProjectStats } from "@/lib/project-stats";
import { applyOptimisticTaskUpdate } from "@/lib/task-cache";
import { refreshDashboardStats } from "@/lib/dashboard-refresh";
import { taskLocateHighlightClass } from "@/hooks/useLocateTaskInView";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { clientCanViewDueDate } from "@/lib/client-visibility";
import { useOrgPipelineStages } from "@/hooks/useOrgPipelineStages";
import { extractTaskTags } from "@/lib/task-tags";
import { isCompletedTask } from "@/lib/task-kanban";
import {
  isPipelineStageDeletable,
  tasksForPipelineColumn,
  withOrphanPipelineStages,
  type PipelineStageDef,
  type ProjectPipelineStageKey,
} from "@/lib/task-kanban";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type KanbanTask = {
  id: number;
  title: string;
  status: string;
  stage?: string | null;
  priority: string;
  dueDate?: string | Date | null;
  estimatedHours?: string | number | null;
  actualHours?: string | number | null;
  assignee?: { name: string | null; avatar?: string | null } | null;
  tags?: string[] | null;
  metadata?: unknown;
  subtaskCount?: number | null;
  completedSubtaskCount?: number | null;
};

const KANBAN_PRIORITY: Record<string, { label: string; className: string }> = {
  urgent: { label: "Urgent", className: "text-red-600" },
  high: { label: "High", className: "text-orange-500" },
  medium: { label: "Medium", className: "text-indigo-500" },
  low: { label: "Low", className: "text-gray-400" },
};

function kanbanTags(task: KanbanTask): string[] {
  if (task.tags?.length) return task.tags.slice(0, 4);
  return extractTaskTags(task).slice(0, 4);
}

function KanbanPriority({ priority }: { priority: string }) {
  const config = KANBAN_PRIORITY[priority] ?? KANBAN_PRIORITY.low;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium shrink-0", config.className)}>
      <Flag size={11} strokeWidth={2.25} />
      {config.label}
    </span>
  );
}

function KanbanTaskCard({
  task,
  columnColor,
  draggedTask,
  isHighlighted,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  task: KanbanTask;
  columnColor: string;
  draggedTask: number | null;
  isHighlighted?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const { user } = useAuth();
  const showDueDate = clientCanViewDueDate(user);
  const tags = kanbanTags(task);
  const subtaskTotal = task.subtaskCount ?? 0;
  const subtaskDone = task.completedSubtaskCount ?? 0;
  const subtaskPct = subtaskTotal > 0 ? Math.round((subtaskDone / subtaskTotal) * 100) : 0;
  const due = task.dueDate ? formatKanbanDueLabel(task.dueDate) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cn(draggedTask === task.id && "opacity-50", isHighlighted && taskLocateHighlightClass)}
    >
      <div
        draggable
        data-task-locate-id={task.id}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onClick}
        className="bg-white rounded-xl px-3.5 py-3 cursor-grab active:cursor-grabbing border border-gray-100/80 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:shadow-[0_4px_10px_rgba(15,23,42,0.08)] transition-shadow"
      >
        <div className="flex items-start gap-2">
        <span className="text-[13px] font-semibold text-[#111827] leading-snug flex-1 min-w-0">
          {task.title}
        </span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="shrink-0 -mr-1 -mt-0.5 p-1 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-50"
              aria-label="Task actions"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <MoreVertical size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
            >
              Open
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-gray-100 px-2 py-[2px] text-[10px] font-medium text-gray-500"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {subtaskTotal > 0 ? (
          <div className="mt-2.5">
            <p className="text-[11px] text-gray-400">
              {subtaskDone}/{subtaskTotal} subtasks
            </p>
            <div className="mt-1.5 h-[3px] rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${subtaskPct}%`,
                  backgroundColor: columnColor,
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 mt-3 min-h-[22px]">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <KanbanPriority priority={task.priority} />
            {showDueDate && due ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-medium truncate",
                  due.tone === "overdue"
                    ? "text-red-500"
                    : due.tone === "today"
                      ? "text-orange-500"
                      : "text-gray-400",
                )}
              >
                <Calendar size={11} className="shrink-0" />
                {due.text}
              </span>
            ) : null}
          </div>
          {task.assignee ? (
            <UserAvatar name={task.assignee.name} avatar={task.assignee.avatar} size={22} />
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

type TaskListQueryInput = {
  limit: number;
  projectId?: number;
  assigneeId?: number;
};

interface TaskKanbanBoardProps {
  tasks: KanbanTask[];
  isLoading?: boolean;
  onTaskClick: (id: number) => void;
  canCreate?: boolean;
  projectId?: number;
  listQueryInput?: TaskListQueryInput;
  onCreateClick?: (stage: ProjectPipelineStageKey) => void;
  highlightedTaskId?: number | null;
  /** Pipeline columns (defaults + project custom sections). */
  stages?: PipelineStageDef[];
  /** Show "New section" column (project board only). */
  canAddSection?: boolean;
  onAddSection?: (label: string) => Promise<void> | void;
  addingSection?: boolean;
  /** Rename column label only (stage key stays the same). */
  canRenameSection?: boolean;
  onRenameSection?: (key: string, label: string) => Promise<void> | void;
  renamingSection?: boolean;
  canDeleteSection?: boolean;
  onDeleteSection?: (key: string) => Promise<void> | void;
  deletingSection?: boolean;
  canReorderSection?: boolean;
  onReorderSection?: (key: string, direction: "left" | "right") => Promise<void> | void;
  reorderingSection?: boolean;
  className?: string;
}

export function TaskKanbanBoard({
  tasks,
  isLoading,
  onTaskClick,
  canCreate = true,
  projectId,
  listQueryInput,
  onCreateClick,
  highlightedTaskId = null,
  stages: stagesProp,
  canAddSection = false,
  onAddSection,
  addingSection = false,
  canRenameSection = false,
  onRenameSection,
  renamingSection = false,
  canDeleteSection = false,
  onDeleteSection,
  deletingSection = false,
  canReorderSection = false,
  onReorderSection,
  reorderingSection = false,
  className,
}: TaskKanbanBoardProps) {
  const orgStages = useOrgPipelineStages();
  const stages = stagesProp && stagesProp.length > 0 ? stagesProp : orgStages;
  const [draggedTask, setDraggedTask] = useState<number | null>(null);
  const didDragRef = useRef(false);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const newSectionInputRef = useRef<HTMLInputElement>(null);
  const [editingColumnKey, setEditingColumnKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();

  const listInput =
    listQueryInput ?? (projectId ? { projectId, limit: 200 } : { limit: 200 });

  const updateMutation = trpc.task.update.useMutation({
    onMutate: async (input) => {
      const current = tasks.find((task) => task.id === input.id);
      if (!current) return {};
      const previous = utils.task.list.getData(listInput);
      await applyOptimisticTaskUpdate(utils, current, input);
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        utils.task.list.setData(listInput, context.previous);
      }
      void refreshDashboardStats(utils);
    },
    onSettled: async () => {
      await Promise.all([
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
        refreshDashboardStats(utils),
      ]);
      invalidateProjectStats(utils, projectId);
    },
  });

  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    e.stopPropagation();
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
      updateMutation.mutate({
        id: draggedTask,
        stage: columnKey,
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

  const submitNewSection = async () => {
    const label = newSectionLabel.trim();
    if (!label || !onAddSection || addingSection) return;
    await onAddSection(label);
    setNewSectionLabel("");
    setIsAddingSection(false);
  };

  const beginRename = (column: PipelineStageDef) => {
    if (!canRenameSection || !onRenameSection || renamingSection) return;
    setEditingColumnKey(column.key);
    setEditingLabel(column.label);
    requestAnimationFrame(() => renameInputRef.current?.select());
  };

  const cancelRename = () => {
    setEditingColumnKey(null);
    setEditingLabel("");
  };

  const tasksByColumn = (columnKey: string) => tasksForPipelineColumn(tasks, columnKey);

  const columns = withOrphanPipelineStages(stages, tasks);

  const columnCounts = useMemo(
    () => columns.map((column) => ({ ...column, count: tasksForPipelineColumn(tasks, column.key).length })),
    [columns, tasks],
  );

  const completePercent = useMemo(() => {
    if (tasks.length === 0) return 0;
    return Math.round((tasks.filter(isCompletedTask).length / tasks.length) * 100);
  }, [tasks]);

  const submitRename = async () => {
    if (!editingColumnKey || !onRenameSection || renamingSection) return;
    const label = editingLabel.trim();
    const current = columns.find((c) => c.key === editingColumnKey);
    if (!label || !current || label === current.label) {
      cancelRename();
      return;
    }
    await onRenameSection(editingColumnKey, label);
    cancelRename();
  };

  const handleDeleteSection = async (column: PipelineStageDef) => {
    if (!canDeleteSection || !onDeleteSection || deletingSection) return;
    if (!isPipelineStageDeletable(column.key)) return;
    const count = tasksByColumn(column.key).length;
    const message =
      count > 0
        ? `Delete "${column.label}"? ${count} task(s) in this section will move to To Do.`
        : `Delete "${column.label}"?`;
    if (!window.confirm(message)) return;
    await onDeleteSection(column.key);
  };

  const handleReorderSection = async (
    column: PipelineStageDef,
    direction: "left" | "right",
  ) => {
    if (!canReorderSection || !onReorderSection || reorderingSection) return;
    await onReorderSection(column.key, direction);
  };

  const toggleCollapsed = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3 min-h-0 h-[calc(100vh-12.5rem)]", className)}>
      <div className="shrink-0 space-y-2.5">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-gray-200 flex">
            {columnCounts.every((column) => column.count === 0) ? (
              <div className="flex-1 bg-gray-200" />
            ) : (
              columnCounts.map((column) =>
                column.count > 0 ? (
                  <div
                    key={column.key}
                    className="h-full min-w-0"
                    style={{ flexGrow: column.count, backgroundColor: column.color }}
                  />
                ) : null,
              )
            )}
          </div>
          <span className="text-[11px] text-gray-400 whitespace-nowrap tabular-nums">
            {completePercent}% complete
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {columnCounts.map((column) => (
            <span key={column.key} className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 whitespace-nowrap">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: column.color }}
              />
              {column.label}
              <span className="text-gray-300">·</span>
              {column.count}
            </span>
          ))}
        </div>
      </div>

      <EdgeScrollArea className="flex-1 min-h-0 !overflow-y-hidden" showScrollbar>
        <div className="flex gap-4 w-max min-w-full pb-2 items-start h-full">
          {columns.map((column, columnIndex) => {
            const columnTasks = tasksByColumn(column.key);
            const isDragOver = dragOverColumn === column.key;
            const collapsed = collapsedKeys.has(column.key);
            const canMoveLeft = canReorderSection && onReorderSection && columnIndex > 0;
            const canMoveRight =
              canReorderSection && onReorderSection && columnIndex < columns.length - 1;
            const showReorderControls = Boolean(canReorderSection && onReorderSection);
            const hasSectionActions =
              (canRenameSection && Boolean(onRenameSection)) ||
              (canDeleteSection && Boolean(onDeleteSection) && isPipelineStageDeletable(column.key)) ||
              showReorderControls;

            return (
              <div
                key={column.key}
                className={cn(
                  "w-[280px] shrink-0 flex flex-col max-h-full overflow-hidden rounded-2xl px-2.5 pt-2 pb-2.5 transition-colors",
                  "bg-[#F1F3F6] dark:!bg-[#1a2336]",
                  isDragOver && "ring-2 ring-[#2563EB]/35 bg-blue-50 dark:!bg-[#1a2740]",
                )}
                onDragOver={(e) => handleDragOver(e, column.key)}
                onDrop={(e) => handleDrop(e, column.key)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverColumn(null);
                  }
                }}
              >
                <div className="group/header flex items-center gap-2 px-1 py-1.5 shrink-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: column.color }}
                  />
                  {editingColumnKey === column.key ? (
                    <input
                      ref={renameInputRef}
                      value={editingLabel}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitRename();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={() => void submitRename()}
                      disabled={renamingSection}
                      className="h-7 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                      aria-label="Rename section"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => beginRename(column)}
                      disabled={!canRenameSection || !onRenameSection}
                      title={canRenameSection ? "Click to rename" : undefined}
                      className={cn(
                        "text-sm font-semibold text-[#111827] truncate text-left min-w-0",
                        canRenameSection && onRenameSection ? "cursor-text" : "cursor-default",
                      )}
                    >
                      {column.label}
                    </button>
                  )}
                  <span className="text-[12px] font-medium text-gray-400 tabular-nums">
                    {columnTasks.length}
                  </span>
                  <div className="ml-auto flex items-center gap-0.5">
                    {hasSectionActions && editingColumnKey !== column.key ? (
                      <>
                        {showReorderControls ? (
                          <button
                            type="button"
                            onClick={() => void handleReorderSection(column, "left")}
                            disabled={!canMoveLeft || reorderingSection}
                            className={cn(
                              "p-1 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100",
                              "opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100",
                              (!canMoveLeft || reorderingSection) && "cursor-not-allowed",
                            )}
                            aria-label={`Move ${column.label} left`}
                            title="Move left"
                          >
                            <ChevronLeft size={14} />
                          </button>
                        ) : null}
                        {canRenameSection && onRenameSection ? (
                          <button
                            type="button"
                            onClick={() => beginRename(column)}
                            className="p-1 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
                            aria-label={`Rename ${column.label}`}
                            title="Rename section"
                          >
                            <Pencil size={12} />
                          </button>
                        ) : null}
                        {canDeleteSection &&
                        onDeleteSection &&
                        isPipelineStageDeletable(column.key) ? (
                          <button
                            type="button"
                            onClick={() => void handleDeleteSection(column)}
                            disabled={deletingSection}
                            className="p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
                            aria-label={`Delete ${column.label}`}
                            title="Delete section"
                          >
                            <Trash2 size={12} />
                          </button>
                        ) : null}
                        {showReorderControls ? (
                          <button
                            type="button"
                            onClick={() => void handleReorderSection(column, "right")}
                            disabled={!canMoveRight || reorderingSection}
                            className={cn(
                              "p-1 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100",
                              "opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100",
                              (!canMoveRight || reorderingSection) && "cursor-not-allowed",
                            )}
                            aria-label={`Move ${column.label} right`}
                            title="Move right"
                          >
                            <ChevronRight size={14} />
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(column.key)}
                      className="p-0.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                      aria-label={collapsed ? `Expand ${column.label}` : `Collapse ${column.label}`}
                    >
                      <ChevronDown
                        size={15}
                        className={cn("transition-transform", collapsed && "-rotate-90")}
                      />
                    </button>
                  </div>
                </div>

                {!collapsed ? (
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain scrollbar-thin">
                    <div className="space-y-2">
                      <AnimatePresence mode="sync">
                        {columnTasks.map((task) => (
                          <KanbanTaskCard
                            key={task.id}
                            task={task}
                            columnColor={column.color}
                            draggedTask={draggedTask}
                            isHighlighted={highlightedTaskId === task.id}
                            onDragStart={(e) => handleDragStart(e, task.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => {
                              if (!didDragRef.current) onTaskClick(task.id);
                            }}
                          />
                        ))}
                      </AnimatePresence>

                      {columnTasks.length === 0 && isDragOver && (
                        <p className="text-xs text-[#2563EB] text-center py-8">Drop here</p>
                      )}
                    </div>

                    {canCreate && onCreateClick ? (
                      <button
                        type="button"
                        onClick={() => onCreateClick(column.key)}
                        className="mt-2 mb-0.5 inline-flex items-center gap-1.5 px-1 py-1.5 text-[13px] text-gray-400 hover:text-gray-600 transition-colors self-start"
                      >
                        <Plus size={14} />
                        Add task
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {canAddSection && onAddSection ? (
            <div className="w-[280px] shrink-0 rounded-2xl border-2 border-dashed border-gray-200 bg-[#F1F3F6] dark:!bg-[#1a2336] dark:border-[#2d3a4f] flex flex-col px-2.5 pt-2 pb-2.5">
              <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB] shrink-0" />
                <span className="text-sm font-semibold text-[#111827]">New Section</span>
              </div>
              {isAddingSection ? (
                <div className="p-3 flex flex-col gap-2">
                  <input
                    ref={newSectionInputRef}
                    autoFocus
                    value={newSectionLabel}
                    onChange={(e) => setNewSectionLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void submitNewSection();
                      }
                      if (e.key === "Escape") {
                        setIsAddingSection(false);
                        setNewSectionLabel("");
                      }
                    }}
                    placeholder="Section name"
                    disabled={addingSection}
                    className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void submitNewSection()}
                      disabled={!newSectionLabel.trim() || addingSection}
                      className="h-8 px-3 rounded-lg bg-[#2563EB] text-white text-xs font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      {addingSection ? "Adding…" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingSection(false);
                        setNewSectionLabel("");
                      }}
                      disabled={addingSection}
                      className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingSection(true);
                    requestAnimationFrame(() => newSectionInputRef.current?.focus());
                  }}
                  className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-[#2563EB] hover:bg-blue-50/60 rounded-xl transition-colors"
                >
                  <Plus size={22} />
                  <span className="text-sm font-semibold">Add New Section</span>
                  <span className="text-[11px] text-gray-500 text-center px-2">
                    Creates a status column for this project
                  </span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      </EdgeScrollArea>
    </div>
  );
}
