import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  taskBelongsToPipelineColumn,
  tasksForPipelineColumn,
  withOrphanPipelineStages,
  type PipelineStageDef,
  type ProjectPipelineStageKey,
} from "@/lib/task-kanban";
import {
  applyKanbanReorder,
  columnKeyAtPoint,
  columnScrollDelta,
  dropIndexInColumn,
  reorderColumnIds,
  sortKanbanTasks,
  type KanbanReorderItem,
} from "@/lib/kanban-dnd";
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
  position?: number | null;
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
  onPointerDown,
  onClick,
}: {
  task: KanbanTask;
  columnColor: string;
  draggedTask: number | null;
  isHighlighted?: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
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
      data-kanban-card={task.id}
      className={cn(
        draggedTask === task.id && "opacity-40",
        isHighlighted && taskLocateHighlightClass,
      )}
    >
      <div
        data-task-locate-id={task.id}
        onPointerDown={onPointerDown}
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
  const [dragGhost, setDragGhost] = useState<{
    title: string;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const didDragRef = useRef(false);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [placedTasks, setPlacedTasks] = useState<KanbanTask[] | null>(null);
  const [columnOrder, setColumnOrder] = useState<Record<string, number[]> | null>(null);
  const columnOrderRef = useRef<Record<string, number[]> | null>(null);
  columnOrderRef.current = columnOrder;
  const dragOriginRef = useRef<{ columnKey: string; ids: number[] } | null>(null);
  const placedTasksRef = useRef<KanbanTask[] | null>(null);
  placedTasksRef.current = placedTasks;
  const dragSnapshotRef = useRef<{
    columnOrder: Record<string, number[]> | null;
    placedTasks: KanbanTask[] | null;
  } | null>(null);
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const newSectionInputRef = useRef<HTMLInputElement>(null);
  const [editingColumnKey, setEditingColumnKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    taskId: number;
    title: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    cardLeft: number;
    cardTop: number;
    cardHeight: number;
    active: boolean;
    frame: number;
  } | null>(null);

  const boardTasks = placedTasks ?? tasks;
  const boardTasksRef = useRef(boardTasks);
  boardTasksRef.current = boardTasks;
  const dragListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    dragListenersRef.current?.();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!columnOrder || dragSessionRef.current?.active) return;
    const order = new Map(tasks.map((task, index) => [task.id, index]));
    const synced = Object.entries(columnOrder).every(([key, ids]) => {
      const serverIds = sortKanbanTasks(tasksForPipelineColumn(tasks, key), order).map((task) => task.id);
      return serverIds.length === ids.length && serverIds.every((id, index) => id === ids[index]);
    });
    if (synced) {
      setColumnOrder(null);
      setPlacedTasks(null);
    }
  }, [tasks, columnOrder]);

  const utils = trpc.useUtils();

  const listInput =
    listQueryInput ?? (projectId ? { projectId, limit: 200 } : { limit: 200 });

  const reorderMutation = trpc.task.reorder.useMutation({
    onMutate: async (input) => {
      await utils.task.list.cancel();
      const previous = utils.task.list.getData(listInput);
      utils.task.list.setData(listInput, (current) => {
        if (!current) return current;
        return {
          ...current,
          tasks: applyKanbanReorder(current.tasks as KanbanTask[], input.items) as typeof current.tasks,
        };
      });
      return { previous };
    },
    onError: (_err, _input, context) => {
      setColumnOrder(null);
      setPlacedTasks(null);
      if (context?.previous) {
        utils.task.list.setData(listInput, context.previous);
      }
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

  const listOrder = useMemo(
    () => new Map(boardTasks.map((task, index) => [task.id, index])),
    [boardTasks],
  );

  const tasksByColumn = (columnKey: string) => {
    const sorted = sortKanbanTasks(tasksForPipelineColumn(boardTasks, columnKey), listOrder);
    const ids = columnOrder?.[columnKey];
    if (!ids?.length) return sorted;
    const byId = new Map(sorted.map((task) => [task.id, task]));
    const ordered: KanbanTask[] = [];
    const seen = new Set<number>();
    for (const id of ids) {
      const task = byId.get(id);
      if (!task || seen.has(id)) continue;
      seen.add(id);
      ordered.push(task);
    }
    for (const task of sorted) {
      if (!seen.has(task.id)) ordered.push(task);
    }
    return ordered;
  };

  const columns = withOrphanPipelineStages(stages, boardTasks);

  const columnCounts = useMemo(
    () => columns.map((column) => ({ ...column, count: tasksForPipelineColumn(boardTasks, column.key).length })),
    [columns, boardTasks],
  );

  const completePercent = useMemo(() => {
    if (boardTasks.length === 0) return 0;
    return Math.round((boardTasks.filter(isCompletedTask).length / boardTasks.length) * 100);
  }, [boardTasks]);

  const clearDragVisual = () => {
    const session = dragSessionRef.current;
    if (session) cancelAnimationFrame(session.frame);
    dragSessionRef.current = null;
    dragOriginRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setDraggedTask(null);
    setDragGhost(null);
    setDragOverColumn(null);
  };

  const scrollColumnsAtPointer = (clientX: number, clientY: number) => {
    const board = boardRef.current;
    if (!board) return;
    const scrollers = board.querySelectorAll<HTMLElement>("[data-kanban-column-scroll]");
    for (const el of scrollers) {
      // Scroll when the pointer or the card hanging below it reaches the edge.
      const delta = columnScrollDelta(el, clientX, clientY) || columnScrollDelta(el, clientX, clientY + 56);
      if (delta === 0) continue;
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = Math.min(max, Math.max(0, el.scrollTop + delta));
      break;
    }
  };

  const sameIds = (left: number[], right: number[]) =>
    left.length === right.length && left.every((id, index) => id === right[index]);

  const visualColumnIds = (columnKey: string) => {
    const currentTasks = boardTasksRef.current;
    const order = new Map(currentTasks.map((task, index) => [task.id, index]));
    const sorted = sortKanbanTasks(tasksForPipelineColumn(currentTasks, columnKey), order);
    const override = columnOrderRef.current?.[columnKey];
    if (!override?.length) return sorted.map((task) => task.id);
    const known = new Set(sorted.map((task) => task.id));
    const ordered = override.filter((id) => known.has(id));
    const seen = new Set(ordered);
    for (const task of sorted) {
      if (!seen.has(task.id)) ordered.push(task.id);
    }
    return ordered;
  };

  const columnKeyForTask = (taskId: number) => {
    const orders = columnOrderRef.current;
    if (orders) {
      for (const [key, ids] of Object.entries(orders)) {
        if (ids.includes(taskId)) return key;
      }
    }
    const task = boardTasksRef.current.find((entry) => entry.id === taskId);
    if (!task) return null;
    const columnKeys = withOrphanPipelineStages(stages, boardTasksRef.current).map((column) => column.key);
    return columnKeys.find((key) => taskBelongsToPipelineColumn(task, key)) ?? null;
  };

  const rememberColumnOrder = (next: Record<string, number[]>) => {
    columnOrderRef.current = next;
    setColumnOrder(next);
  };

  const moveDraggedTask = (taskId: number, clientX: number, clientY: number) => {
    const board = boardRef.current;
    const session = dragSessionRef.current;
    if (!board || !session?.active) return;
    const cardCenterY = clientY + (session.cardTop + session.cardHeight / 2 - session.startY);
    const columnKey =
      columnKeyAtPoint(board, clientX, cardCenterY) ??
      columnKeyAtPoint(board, clientX, clientY);
    if (!columnKey) return;
    const columnEl = [...board.querySelectorAll<HTMLElement>("[data-kanban-column]")].find(
      (el) => el.dataset.kanbanColumnKey === columnKey,
    );
    const scroll = columnEl?.querySelector<HTMLElement>("[data-kanban-column-scroll]");
    const index = dropIndexInColumn(scroll, cardCenterY, taskId);
    const sourceKey = columnKeyForTask(taskId) ?? columnKey;
    const sourceIds = visualColumnIds(sourceKey);
    const targetIds = sourceKey === columnKey ? sourceIds : visualColumnIds(columnKey);
    const nextTargetIds = reorderColumnIds(targetIds, taskId, index);
    const nextSourceIds = sourceKey === columnKey ? nextTargetIds : sourceIds.filter((id) => id !== taskId);
    setDragOverColumn((prev) => (prev === columnKey ? prev : columnKey));
    if (sameIds(nextTargetIds, targetIds) && sameIds(nextSourceIds, sourceIds)) return;

    rememberColumnOrder({
      ...(columnOrderRef.current ?? {}),
      ...(sourceKey === columnKey ? {} : { [sourceKey]: nextSourceIds }),
      [columnKey]: nextTargetIds,
    });

    if (sourceKey !== columnKey) {
      const items: KanbanReorderItem[] = [
        ...nextSourceIds.map((id, position) => ({ id, position })),
        ...nextTargetIds.map((id, position) => ({
          id,
          position,
          ...(id === taskId ? { stage: columnKey } : {}),
        })),
      ];
      const placed = applyKanbanReorder(boardTasksRef.current, items);
      boardTasksRef.current = placed;
      setPlacedTasks(placed);
    }
  };

  const persistDraggedTask = (taskId: number) => {
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (!origin) return;
    const columnKey = columnKeyForTask(taskId) ?? origin.columnKey;
    const ids = visualColumnIds(columnKey);
    if (columnKey === origin.columnKey && sameIds(ids, origin.ids)) return;

    const sourceIds = columnKey === origin.columnKey ? ids : visualColumnIds(origin.columnKey);
    const items: KanbanReorderItem[] = columnKey === origin.columnKey
      ? ids.map((id, position) => ({ id, position }))
      : [
          ...sourceIds.map((id, position) => ({ id, position })),
          ...ids.map((id, position) => ({
            id,
            position,
            ...(id === taskId ? { stage: columnKey } : {}),
          })),
        ];
    const placed = applyKanbanReorder(boardTasksRef.current, items);
    boardTasksRef.current = placed;
    setPlacedTasks(placed);
    reorderMutation.mutate({ items });
  };

  const moveDraggedTaskRef = useRef(moveDraggedTask);
  const persistDraggedTaskRef = useRef(persistDraggedTask);
  moveDraggedTaskRef.current = moveDraggedTask;
  persistDraggedTaskRef.current = persistDraggedTask;

  const beginPointerDrag = (event: React.PointerEvent<HTMLDivElement>, task: KanbanTask) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, [role='menuitem']")) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const cardRect = event.currentTarget.getBoundingClientRect();
    const session = {
      pointerId: event.pointerId,
      taskId: task.id,
      title: task.title,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      cardLeft: cardRect.left,
      cardTop: cardRect.top,
      cardHeight: cardRect.height,
      active: false,
      frame: 0,
    };
    dragSessionRef.current = session;

    const placeGhost = (x: number, y: number) => {
      const ghost = ghostRef.current;
      const current = dragSessionRef.current;
      if (!ghost || !current) return;
      const left = x - (current.startX - current.cardLeft);
      const top = y - (current.startY - current.cardTop);
      ghost.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    };

    const tick = () => {
      const current = dragSessionRef.current;
      if (!current?.active) return;
      scrollColumnsAtPointer(current.x, current.y);
      moveDraggedTaskRef.current(current.taskId, current.x, current.y);
      placeGhost(current.x, current.y);
      current.frame = requestAnimationFrame(tick);
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const current = dragSessionRef.current;
      if (!current || moveEvent.pointerId !== current.pointerId) return;
      current.x = moveEvent.clientX;
      current.y = moveEvent.clientY;
      if (!current.active) {
        const distance = Math.hypot(moveEvent.clientX - current.startX, moveEvent.clientY - current.startY);
        if (distance < 6) return;
        current.active = true;
        didDragRef.current = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        const originColumn = columnKeyForTask(current.taskId);
        dragOriginRef.current = originColumn
          ? { columnKey: originColumn, ids: visualColumnIds(originColumn) }
          : null;
        dragSnapshotRef.current = {
          columnOrder: columnOrderRef.current,
          placedTasks: placedTasksRef.current,
        };
        setDraggedTask(current.taskId);
        setDragGhost({
          title: current.title,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          offsetX: current.startX - current.cardLeft,
          offsetY: current.startY - current.cardTop,
        });
        current.frame = requestAnimationFrame(tick);
      }
      placeGhost(moveEvent.clientX, moveEvent.clientY);
    };

    const finish = (endEvent: PointerEvent) => {
      const current = dragSessionRef.current;
      if (!current || endEvent.pointerId !== current.pointerId) return;
      dragListenersRef.current?.();
      dragListenersRef.current = null;
      const wasActive = current.active;
      const taskId = current.taskId;
      current.x = endEvent.clientX;
      current.y = endEvent.clientY;
      cancelAnimationFrame(current.frame);
      if (wasActive && endEvent.type !== "pointercancel") {
        moveDraggedTaskRef.current(taskId, endEvent.clientX, endEvent.clientY);
      }
      dragSessionRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (!wasActive) {
        dragSnapshotRef.current = null;
        return;
      }
      persistDraggedTaskRef.current(taskId);
      dragSnapshotRef.current = null;
      clearDragVisual();
      requestAnimationFrame(() => {
        didDragRef.current = false;
      });
    };

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      dragListenersRef.current?.();
      dragListenersRef.current = null;
      const snapshot = dragSnapshotRef.current;
      dragSnapshotRef.current = null;
      if (snapshot) {
        columnOrderRef.current = snapshot.columnOrder;
        setColumnOrder(snapshot.columnOrder);
        setPlacedTasks(snapshot.placedTasks);
      }
      clearDragVisual();
      requestAnimationFrame(() => {
        didDragRef.current = false;
      });
    };

    const detach = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", onKeyDown);
    };
    dragListenersRef.current = detach;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", onKeyDown);
  };

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
    <div ref={boardRef} className={cn("flex flex-col gap-3 min-h-0 h-[calc(100vh-12.5rem)]", className)}>
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
        <div className="flex gap-4 w-max min-w-full pb-2 items-stretch h-full min-h-0">
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
                data-kanban-column=""
                data-kanban-column-key={column.key}
                className={cn(
                  "w-[280px] shrink-0 flex flex-col h-full min-h-0 max-h-full overflow-hidden rounded-2xl px-2.5 pt-2 pb-2.5 transition-colors",
                  "bg-[#F1F3F6] dark:!bg-[#1a2336]",
                  isDragOver && "ring-2 ring-[#2563EB]/35 bg-blue-50 dark:!bg-[#1a2740]",
                )}
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
                  <div
                    data-kanban-column-scroll=""
                    className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain scrollbar-thin"
                  >
                    <div className="space-y-2">
                      <AnimatePresence mode="sync">
                        {columnTasks.map((task) => (
                          <KanbanTaskCard
                            key={task.id}
                            task={task}
                            columnColor={column.color}
                            draggedTask={draggedTask}
                            isHighlighted={highlightedTaskId === task.id}
                            onPointerDown={(event) => beginPointerDrag(event, task)}
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
      {dragGhost
        ? createPortal(
            <div
              ref={ghostRef}
              className="fixed left-0 top-0 z-[80] w-[248px] pointer-events-none rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-[13px] font-semibold text-[#111827] shadow-[0_12px_28px_rgba(15,23,42,0.18)]"
              style={{ transform: `translate3d(${dragGhost.x - dragGhost.offsetX}px, ${dragGhost.y - dragGhost.offsetY}px, 0)` }}
            >
              {dragGhost.title}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
