import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { PriorityBadge } from "@/components/shared/StatusBadge";
import { formatDueLabel, isTaskOverdue } from "@/lib/task-deadline";
import { taskLocateHighlightClass } from "@/hooks/useLocateTaskInView";
import { useTaskLiveTimer } from "@/hooks/useTaskLiveTimer";
import { cn, formatElapsedHMS, priorityConfig } from "@/lib/utils";
import {
  isTaskPriority,
  TASK_PRIORITY_OPTIONS,
  type TaskPriority,
} from "@/components/tasks/task-form-ui";
import { canChangeTaskAssignee } from "@/lib/change-assignee-permission";
import { isTaskAssignableUser } from "@/lib/leave-policy";
import { hasPermission } from "@/lib/permissions";
import { useOrgPipelineStages } from "@/hooks/useOrgPipelineStages";
import {
  tasksForPipelineColumn,
  withOrphanPipelineStages,
  type PipelineStageDef,
  type ProjectPipelineStageKey,
} from "@/lib/task-kanban";
import { applyOptimisticTaskUpdate, patchTaskInListCaches } from "@/lib/task-cache";
import { invalidateProjectStats } from "@/lib/project-stats";
import { refreshDashboardStats } from "@/lib/dashboard-refresh";
import { invalidateTaskQueries } from "@/lib/invalidate-on-notifications";
import { trpc } from "@/providers/trpc";
import { Check, ChevronDown, ClipboardList, Clock, FolderKanban, GripVertical, Loader2 } from "lucide-react";
import { groupTasksByClientAndProject } from "@/lib/client-task-groups";
import { formatWorkZoneDate, workZoneDateKey, workZoneDateParts, workZoneWallTimeToUtc } from "@/lib/timezone";
import { useAuth } from "@/hooks/useAuth";
import { clientCanViewDueDate, clientCanViewTimeTracking } from "@/lib/client-visibility";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type ListTask = {
  id: number;
  title: string;
  status: string;
  stage?: string | null;
  priority: string;
  createdBy?: number | null;
  assigneeId?: number | null;
  projectId?: number | null;
  createdAt?: string | Date | null;
  dueDate?: string | Date | null;
  project?: { id: number; name: string; color?: string | null; clientName?: string | null } | null;
  assignee?: { id?: number; name: string | null; avatar?: string | null } | null;
  creator?: { name: string | null; avatar?: string | null } | null;
};

type ProjectOption = { id: number; name: string; color?: string | null; clientName?: string | null };

type TaskListQueryInput = {
  limit: number;
  projectId?: number;
  assigneeId?: number;
};

function formatListDate(value?: string | Date | null) {
  return formatWorkZoneDate(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface TaskListViewProps {
  tasks: ListTask[];
  isLoading?: boolean;
  onTaskClick: (id: number) => void;
  emptyMessage?: string;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  onToggleSelectAll?: () => void;
  highlightedTaskId?: number | null;
  projectId?: number;
  listQueryInput?: TaskListQueryInput;
  /**
   * Group rows by pipeline stage (project list view only).
   * My Tasks / All Tasks keep a flat list.
   */
  groupByStage?: boolean;
  /** When false, rows are not draggable between stage groups. Default matches groupByStage. */
  enableStageDrag?: boolean;
  /** Pipeline groups (defaults + project custom sections). */
  stages?: PipelineStageDef[];
  /** Allow changing a task’s project from the Project column (e.g. All Tasks). */
  allowProjectEdit?: boolean;
  /** Optional preloaded projects for the project editor. */
  projects?: ProjectOption[];
  /** Client's Tasks: nest rows under client/agency, then project. */
  groupByClientProject?: boolean;
  /** Invited-client company names keyed by user id (customer display name). */
  clientNameByUserId?: Record<number, string>;
}

/** Fixed floors so project/assignee names stay readable; the table scrolls on narrow screens. */
const GRID_WITH_CHECKBOX =
  "grid-cols-[40px_minmax(14rem,2.2fr)_minmax(11rem,1.15fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_minmax(7.5rem,0.7fr)_minmax(8.75rem,0.8fr)_minmax(6.75rem,0.65fr)]";
const GRID_WITHOUT_CHECKBOX =
  "grid-cols-[minmax(14rem,2.2fr)_minmax(11rem,1.15fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_minmax(7.5rem,0.7fr)_minmax(8.75rem,0.8fr)_minmax(6.75rem,0.65fr)]";
const GRID_WITH_CHECKBOX_NO_PROJECT =
  "grid-cols-[40px_minmax(14rem,2.4fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_minmax(7.5rem,0.7fr)_minmax(8.75rem,0.8fr)_minmax(6.75rem,0.65fr)]";
const GRID_WITHOUT_CHECKBOX_NO_PROJECT =
  "grid-cols-[minmax(14rem,2.4fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_minmax(7.5rem,0.7fr)_minmax(8.75rem,0.8fr)_minmax(6.75rem,0.65fr)]";
const GRID_WITH_CHECKBOX_NO_DUE =
  "grid-cols-[40px_minmax(14rem,2.2fr)_minmax(11rem,1.15fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_minmax(7.5rem,0.7fr)_minmax(6.75rem,0.65fr)]";
const GRID_WITHOUT_CHECKBOX_NO_DUE =
  "grid-cols-[minmax(14rem,2.2fr)_minmax(11rem,1.15fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_minmax(7.5rem,0.7fr)_minmax(6.75rem,0.65fr)]";
const GRID_WITH_CHECKBOX_NO_PROJECT_NO_DUE =
  "grid-cols-[40px_minmax(14rem,2.4fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_minmax(7.5rem,0.7fr)_minmax(6.75rem,0.65fr)]";
const GRID_WITHOUT_CHECKBOX_NO_PROJECT_NO_DUE =
  "grid-cols-[minmax(14rem,2.4fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_minmax(7.5rem,0.7fr)_minmax(6.75rem,0.65fr)]";

const TABLE_MIN_WIDTH = "min-w-[80rem]";

function listGridCols(opts: {
  selectable: boolean;
  hideProject: boolean;
  hideDueDate: boolean;
}) {
  if (opts.hideProject && opts.hideDueDate) {
    return opts.selectable
      ? GRID_WITH_CHECKBOX_NO_PROJECT_NO_DUE
      : GRID_WITHOUT_CHECKBOX_NO_PROJECT_NO_DUE;
  }
  if (opts.hideProject) {
    return opts.selectable ? GRID_WITH_CHECKBOX_NO_PROJECT : GRID_WITHOUT_CHECKBOX_NO_PROJECT;
  }
  if (opts.hideDueDate) {
    return opts.selectable ? GRID_WITH_CHECKBOX_NO_DUE : GRID_WITHOUT_CHECKBOX_NO_DUE;
  }
  return opts.selectable ? GRID_WITH_CHECKBOX : GRID_WITHOUT_CHECKBOX;
}

function sameUserId(a?: number | null, b?: number | null) {
  return a != null && b != null && Number(a) === Number(b);
}

function canEditTaskListFields(
  user: ReturnType<typeof useAuth>["user"],
  task: ListTask,
) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "manager") return true;
  if (hasPermission(user, "tasks.edit_all")) return true;
  return (
    sameUserId(task.createdBy, user.id) ||
    sameUserId(task.assigneeId ?? task.assignee?.id, user.id)
  );
}

function dueDateToInputValue(value?: string | Date | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return workZoneDateKey(d);
}

function dateInputToDueIso(value: string, previous?: string | Date | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  if (previous) {
    const parts = workZoneDateParts(previous);
    return workZoneWallTimeToUtc(
      year,
      month,
      day,
      parts.hour,
      parts.minute,
      parts.second,
    ).toISOString();
  }
  return workZoneWallTimeToUtc(year, month, day, 19, 0, 0, 0).toISOString();
}

function dueDatesEqual(a?: string | Date | null, b?: string | Date | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return left === right;
}

function stopRowOpen(e: React.SyntheticEvent) {
  e.stopPropagation();
}

function TaskDueDateCell({
  task,
  overdue,
  editable,
  isPending,
  onChange,
}: {
  task: ListTask;
  overdue: boolean;
  editable: boolean;
  isPending: boolean;
  onChange: (dueDate: string | null) => void;
}) {
  const label = task.dueDate
    ? formatDueLabel(task.dueDate, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  if (!editable) {
    return (
      <span
        className={cn(
          "text-xs whitespace-nowrap",
          overdue ? "text-red-600 font-medium" : "text-gray-500",
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <div
      className="min-w-0"
      onClick={stopRowOpen}
      onMouseDown={stopRowOpen}
      onKeyDown={stopRowOpen}
    >
      <label
        className={cn(
          "relative inline-flex min-w-[7.5rem] max-w-full cursor-pointer items-center rounded-md px-1 py-0.5 -mx-1 hover:bg-gray-100",
          isPending && "opacity-60",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-flex items-center gap-0.5 text-xs whitespace-nowrap",
            overdue ? "text-red-600 font-medium" : "text-gray-600",
          )}
        >
          {label}
          <ChevronDown size={12} className="text-gray-400" />
        </span>
        <input
          type="date"
          value={dueDateToInputValue(task.dueDate)}
          disabled={isPending}
          aria-label={`Due date for ${task.title}`}
          title="Change due date"
          onChange={(e) => onChange(dateInputToDueIso(e.target.value, task.dueDate))}
          className={cn(
            "absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait",
            "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0",
            "[&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full",
            "[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
          )}
        />
      </label>
    </div>
  );
}

function TaskPriorityCell({
  task,
  editable,
  isPending,
  onChange,
}: {
  task: ListTask;
  editable: boolean;
  isPending: boolean;
  onChange: (priority: TaskPriority) => void;
}) {
  const [open, setOpen] = useState(false);
  const priority = isTaskPriority(task.priority) ? task.priority : "medium";

  if (!editable) {
    return <PriorityBadge priority={priority} />;
  }

  return (
    <div
      className="inline-flex min-w-0 items-center"
      onClick={stopRowOpen}
      onMouseDown={stopRowOpen}
      onKeyDown={stopRowOpen}
    >
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-0.5 py-0.5 -mx-0.5 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/25",
              isPending && "opacity-60",
            )}
            aria-label={`Change priority for ${task.title}`}
            title="Change priority"
          >
            <PriorityBadge priority={priority} />
            {isPending ? (
              <Loader2 size={12} className="animate-spin text-gray-400" />
            ) : (
              <ChevronDown size={12} className="text-gray-400" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[148px] p-1 rounded-xl border border-gray-200 bg-white shadow-lg"
          sideOffset={6}
        >
          <div className="flex flex-col gap-0.5">
            {TASK_PRIORITY_OPTIONS.map((option) => {
              const selected = option === priority;
              const config = priorityConfig[option];
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-gray-50",
                    selected && "bg-gray-50",
                  )}
                >
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5"
                    style={{ backgroundColor: config.bg, color: config.color }}
                  >
                    {config.label}
                  </span>
                  {selected ? <Check size={12} className="text-[#2563EB]" /> : null}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TaskProjectCell({
  task,
  projects,
  editable,
  isPending,
  onChange,
}: {
  task: ListTask;
  projects: ProjectOption[];
  editable: boolean;
  isPending: boolean;
  onChange: (projectId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const projectOptions = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  const projectLink = task.project ? (
    <Link
      to={`/projects/${task.project.id}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 min-w-0 max-w-full text-xs text-gray-700 hover:text-[#2563EB]"
      title={`Open ${task.project.name}`}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: task.project.color ?? "#2563EB" }}
      />
      <span className="truncate">{task.project.name}</span>
    </Link>
  ) : (
    <span className="text-xs text-gray-400">No project</span>
  );

  if (!editable) {
    return (
      <div className="inline-flex items-center gap-1 min-w-0 w-full" onClick={(e) => e.stopPropagation()}>
        {projectLink}
      </div>
    );
  }

  return (
    <div
      className="min-w-0 inline-flex items-center gap-0.5 max-w-full"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {projectLink}
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending}
            className={cn(
              "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/25",
              isPending && "opacity-60",
            )}
            aria-label={`Change project for ${task.title}`}
            title="Change project"
          >
            {isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ChevronDown size={12} />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[280px] p-0 rounded-xl border border-gray-200 bg-white shadow-lg"
          sideOffset={6}
        >
          <Command>
            <CommandInput placeholder="Search projects…" />
            <CommandList>
              <CommandEmpty>No projects found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="no project"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    size={14}
                    className={cn(
                      "shrink-0 text-[#2563EB]",
                      task.project ? "opacity-0" : "opacity-100",
                    )}
                  />
                  <span>No project</span>
                </CommandItem>
                {projectOptions.map((project) => {
                  const selected = task.project?.id === project.id;
                  return (
                    <CommandItem
                      key={project.id}
                      value={project.name}
                      onSelect={() => {
                        onChange(project.id);
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      <Check
                        size={14}
                        className={cn(
                          "shrink-0 text-[#2563EB]",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: project.color ?? "#2563EB" }}
                      />
                      <span className="truncate">{project.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

type AssigneeOption = {
  id: number;
  name: string | null;
  avatar?: string | null;
  role?: string | null;
  department?: string | null;
};

function TaskAssigneeCell({
  task,
  users,
  editable,
  isPending,
  onChange,
}: {
  task: ListTask;
  users: AssigneeOption[];
  editable: boolean;
  isPending: boolean;
  onChange: (assigneeId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentId = task.assigneeId ?? task.assignee?.id ?? null;
  const options = useMemo(() => {
    const map = new Map<number, AssigneeOption>();
    for (const person of users) {
      if (!isTaskAssignableUser(person)) continue;
      map.set(person.id, person);
    }
    if (task.assignee?.id != null && !map.has(task.assignee.id)) {
      map.set(task.assignee.id, task.assignee);
    }
    return [...map.values()].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
    );
  }, [users, task.assignee]);

  const display = task.assignee ? (
    <>
      <UserAvatar name={task.assignee.name} avatar={task.assignee.avatar} size={22} />
      <span className="text-xs text-gray-600 truncate" title={task.assignee.name ?? undefined}>
        {task.assignee.name}
      </span>
    </>
  ) : (
    <span className="text-xs text-gray-400">Unassigned</span>
  );

  if (!editable) {
    return <div className="flex min-w-0 items-center gap-2">{display}</div>;
  }

  return (
    <div
      className="min-w-0"
      onClick={stopRowOpen}
      onMouseDown={stopRowOpen}
      onKeyDown={stopRowOpen}
    >
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending}
            className={cn(
              "flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 -mx-1 text-left hover:bg-gray-100",
              isPending && "opacity-60",
            )}
            aria-label={`Change assignee for ${task.title}`}
            title="Change assignee"
          >
            {display}
            {isPending ? (
              <Loader2 size={12} className="ml-auto shrink-0 animate-spin text-gray-400" />
            ) : (
              <ChevronDown size={12} className="ml-auto shrink-0 text-gray-400" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[260px] p-0 rounded-xl border border-gray-200 bg-white shadow-lg"
          sideOffset={6}
        >
          <Command>
            <CommandInput placeholder="Search employees…" />
            <CommandList className="max-h-56">
              <CommandEmpty>No employees found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="unassigned"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    size={14}
                    className={cn(
                      "shrink-0 text-[#2563EB]",
                      currentId ? "opacity-0" : "opacity-100",
                    )}
                  />
                  <span>Unassigned</span>
                </CommandItem>
                {options.map((person) => {
                  const selected = currentId === person.id;
                  return (
                    <CommandItem
                      key={person.id}
                      value={person.name ?? `user ${person.id}`}
                      onSelect={() => {
                        onChange(person.id);
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      <Check
                        size={14}
                        className={cn(
                          "shrink-0 text-[#2563EB]",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <UserAvatar name={person.name} avatar={person.avatar} size={22} />
                      <span className="truncate">{person.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TaskListRow({
  task,
  rowClass,
  selectable,
  selectedIds,
  onToggleSelect,
  highlightedTaskId,
  enableStageDrag,
  isDragging,
  onDragStart,
  onDragEnd,
  didDragRef,
  onTaskClick,
  allowProjectEdit,
  allowFieldEdit,
  allowAssigneeEdit,
  projects,
  projectUpdatePending,
  priorityUpdatePending,
  dueDateUpdatePending,
  onProjectChange,
  onPriorityChange,
  onDueDateChange,
  onAssigneeChange,
  assigneeUsers,
  assigneeUpdatePending,
  isTimerRunning,
  timerElapsedSeconds,
  hideProjectColumn = false,
  hideDueDate = false,
  nestCheckboxUnderProject = false,
}: {
  task: ListTask;
  rowClass: string;
  selectable: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  highlightedTaskId: number | null;
  enableStageDrag: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, taskId: number) => void;
  onDragEnd: () => void;
  didDragRef: React.MutableRefObject<boolean>;
  onTaskClick: (id: number) => void;
  allowProjectEdit: boolean;
  allowFieldEdit: boolean;
  allowAssigneeEdit: boolean;
  projects: ProjectOption[];
  assigneeUsers: AssigneeOption[];
  projectUpdatePending: boolean;
  priorityUpdatePending: boolean;
  dueDateUpdatePending: boolean;
  assigneeUpdatePending: boolean;
  onProjectChange: (taskId: number, projectId: number | null) => void;
  onPriorityChange: (taskId: number, priority: TaskPriority) => void;
  onDueDateChange: (taskId: number, dueDate: string | null) => void;
  onAssigneeChange: (taskId: number, assigneeId: number | null) => void;
  isTimerRunning?: boolean;
  timerElapsedSeconds?: number;
  hideProjectColumn?: boolean;
  hideDueDate?: boolean;
  /** Client Tasks: keep the checkbox in the task column, nested under the project title. */
  nestCheckboxUnderProject?: boolean;
}) {
  const overdue = isTaskOverdue(task);
  const isSelected = selectable && selectedIds?.has(task.id);
  const isHighlighted = highlightedTaskId === task.id;

  return (
    <div
      data-task-locate-id={task.id}
      draggable={enableStageDrag}
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragEnd={onDragEnd}
      className={cn(
        `${rowClass} py-3 border-b border-black-50 hover:bg-gray-50 transition-colors text-left`,
        enableStageDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isSelected && "bg-blue-50/40",
        isHighlighted && taskLocateHighlightClass,
        isDragging && "opacity-45",
      )}
      onClick={() => {
        if (didDragRef.current) return;
        onTaskClick(task.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTaskClick(task.id);
        }
      }}
    >
      {selectable && !nestCheckboxUnderProject ? (
        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect?.(task.id)}
            className="h-4 w-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]/30"
            aria-label={`Select ${task.title}`}
          />
        </div>
      ) : null}

      <div
        className={cn(
          "min-w-0 pr-2 flex items-center gap-2",
          nestCheckboxUnderProject && "pl-[4.25rem]",
        )}
      >
        {selectable && nestCheckboxUnderProject ? (
          <div className="flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect?.(task.id)}
              className="h-4 w-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]/30"
              aria-label={`Select ${task.title}`}
            />
          </div>
        ) : null}
        {enableStageDrag ? (
          <GripVertical size={14} className="text-gray-300 shrink-0 pointer-events-none" />
        ) : null}
        <div className="text-sm font-medium text-[#1F2937] truncate">{task.title}</div>
        {isTimerRunning ? (
          <span
            className="inline-flex items-center gap-1 shrink-0 text-xs font-mono font-semibold tabular-nums text-[#2563EB] bg-blue-50 px-1.5 py-0.5 rounded dark:text-white"
            title="Time tracking is running on this task"
            aria-label="Time tracking live"
          >
            <Clock size={12} className="animate-pulse" />
            {formatElapsedHMS(timerElapsedSeconds ?? 0)}
          </span>
        ) : null}
      </div>

      {hideProjectColumn ? null : (
      <div className="min-w-0 pr-2">
        <TaskProjectCell
          task={task}
          projects={projects}
          editable={allowProjectEdit}
          isPending={projectUpdatePending}
          onChange={(nextProjectId) => onProjectChange(task.id, nextProjectId)}
        />
      </div>
      )}

      <div className="min-w-0 pr-2">
        <TaskAssigneeCell
          task={task}
          users={assigneeUsers}
          editable={allowAssigneeEdit}
          isPending={assigneeUpdatePending}
          onChange={(nextAssigneeId) => onAssigneeChange(task.id, nextAssigneeId)}
        />
      </div>

      <div className="flex items-center gap-2 min-w-0 pr-2">
        {task.creator ? (
          <>
            <UserAvatar name={task.creator.name} avatar={task.creator.avatar} size={22} />
            <span className="text-xs text-gray-600 truncate" title={task.creator.name ?? undefined}>
              {task.creator.name}
            </span>
          </>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </div>

      <div className="text-xs text-gray-500 whitespace-nowrap">
        {formatListDate(task.createdAt)}
      </div>

      {hideDueDate ? null : (
      <div className="min-w-0">
        <TaskDueDateCell
          task={task}
          overdue={overdue}
          editable={allowFieldEdit}
          isPending={dueDateUpdatePending}
          onChange={(nextDueDate) => onDueDateChange(task.id, nextDueDate)}
        />
      </div>
      )}

      <div className="flex items-center">
        <TaskPriorityCell
          task={task}
          editable={allowFieldEdit}
          isPending={priorityUpdatePending}
          onChange={(priority) => onPriorityChange(task.id, priority)}
        />
      </div>
    </div>
  );
}

export function TaskListView({
  tasks,
  isLoading,
  onTaskClick,
  emptyMessage = "No tasks found",
  selectable = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  highlightedTaskId = null,
  projectId,
  listQueryInput,
  groupByStage = false,
  enableStageDrag,
  stages: stagesProp,
  allowProjectEdit = false,
  projects: projectsProp,
  groupByClientProject = false,
  clientNameByUserId,
}: TaskListViewProps) {
  const { user } = useAuth();
  const orgStages = useOrgPipelineStages();
  const stages = stagesProp && stagesProp.length > 0 ? stagesProp : orgStages;
  const showDueDate = clientCanViewDueDate(user);
  const showTimeTracking = clientCanViewTimeTracking(user);
  const allowStageDrag = enableStageDrag ?? groupByStage;
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(() => new Set());
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(() => new Set());
  const [collapsedClientProjects, setCollapsedClientProjects] = useState<Set<string>>(() => new Set());
  const [draggedTask, setDraggedTask] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const didDragRef = useRef(false);

  const utils = trpc.useUtils();
  const listInput =
    listQueryInput ?? (projectId ? { projectId, limit: 200 } : { limit: 200 });

  const { data: myActiveTimer } = trpc.task.getMyActiveTimer.useQuery(undefined, {
    enabled: showTimeTracking,
    refetchInterval: (q) =>
      q.state.data?.startedAt && !q.state.data?.paused ? 5000 : false,
  });
  const activeTimer =
    myActiveTimer?.startedAt && !myActiveTimer?.paused ? myActiveTimer : null;
  const { elapsedSeconds: activeTimerElapsedSeconds, isRunning: isActiveTimerRunning } =
    useTaskLiveTimer(activeTimer);
  const activeTimerTaskId = isActiveTimerRunning ? activeTimer?.taskId ?? null : null;

  const { data: fetchedProjects } = trpc.project.list.useQuery(undefined, {
    enabled: allowProjectEdit && !projectsProp,
  });
  const projects = projectsProp ?? fetchedProjects ?? [];
  const { data: usersPicker } = trpc.user.listForPicker.useQuery({ limit: 500 });
  const assigneeUsers = useMemo(
    () => (usersPicker?.users ?? []).filter((person) => isTaskAssignableUser(person)),
    [usersPicker],
  );

  const updateMutation = trpc.task.update.useMutation({
    onMutate: async (input) => {
      const current = tasks.find((task) => task.id === input.id);
      if (!current) return {};
      const previous = utils.task.list.getData(listInput);
      await applyOptimisticTaskUpdate(utils, current, input);
      if (input.projectId !== undefined) {
        const nextProject =
          input.projectId == null
            ? null
            : projects.find((p) => p.id === input.projectId) ??
              (current.project?.id === input.projectId ? current.project : null);
        patchTaskInListCaches(utils, input.id, {
          projectId: input.projectId,
          project: nextProject
            ? {
                id: nextProject.id,
                name: nextProject.name,
                color: nextProject.color ?? null,
              }
            : null,
        });
      }
      if (input.assigneeId !== undefined) {
        const nextAssignee =
          input.assigneeId == null
            ? null
            : assigneeUsers.find((person) => person.id === input.assigneeId) ??
              (current.assignee?.id === input.assigneeId ? current.assignee : null);
        patchTaskInListCaches(utils, input.id, {
          assigneeId: input.assigneeId,
          assignee: nextAssignee
            ? {
                id: nextAssignee.id,
                name: nextAssignee.name,
                avatar: nextAssignee.avatar ?? null,
              }
            : null,
        });
      }
      return { previous, previousProjectId: current.project?.id ?? null };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        utils.task.list.setData(listInput, context.previous);
      }
      void refreshDashboardStats(utils);
    },
    onSettled: async (_data, _err, input, context) => {
      await Promise.all([
        invalidateTaskQueries(utils, { taskIds: [input.id] }),
      ]);
      const previousProjectId =
        context && "previousProjectId" in context
          ? (context.previousProjectId as number | null | undefined)
          : undefined;
      invalidateProjectStats(utils, previousProjectId ?? projectId);
      if (input.projectId != null) {
        invalidateProjectStats(utils, input.projectId);
      }
      invalidateProjectStats(utils, projectId);
    },
  });

  const handleProjectChange = (taskId: number, nextProjectId: number | null) => {
    const current = tasks.find((task) => task.id === taskId);
    const currentId = current?.project?.id ?? null;
    if (currentId === nextProjectId) return;
    updateMutation.mutate({ id: taskId, projectId: nextProjectId });
  };

  const handlePriorityChange = (taskId: number, priority: TaskPriority) => {
    const current = tasks.find((task) => task.id === taskId);
    if (!current || current.priority === priority) return;
    updateMutation.mutate({ id: taskId, priority });
  };

  const handleDueDateChange = (taskId: number, dueDate: string | null) => {
    const current = tasks.find((task) => task.id === taskId);
    if (!current || dueDatesEqual(current.dueDate, dueDate)) return;
    updateMutation.mutate({ id: taskId, dueDate });
  };

  const handleAssigneeChange = (taskId: number, nextAssigneeId: number | null) => {
    const current = tasks.find((task) => task.id === taskId);
    const currentId = current?.assigneeId ?? current?.assignee?.id ?? null;
    if (currentId === nextAssigneeId) return;
    updateMutation.mutate({ id: taskId, assigneeId: nextAssigneeId });
  };

  const stageGroups = useMemo(() => {
    if (!groupByStage || groupByClientProject) return [];
    const resolved = withOrphanPipelineStages(stages, tasks);
    return resolved.map((stage) => ({
      ...stage,
      tasks: tasksForPipelineColumn(tasks, stage.key),
    }));
  }, [tasks, stages, groupByStage, groupByClientProject]);

  const clientProjectGroups = useMemo(() => {
    if (!groupByClientProject) return [];
    const projectClientNameById: Record<number, string> = {};
    for (const project of projects) {
      const name = project.clientName?.trim();
      if (name) projectClientNameById[project.id] = name;
    }
    return groupTasksByClientAndProject(tasks, {
      clientNameByUserId,
      projectClientNameById,
    });
  }, [groupByClientProject, tasks, projects, clientNameByUserId]);

  useEffect(() => {
    if (!groupByClientProject || highlightedTaskId == null) return;
    const clientGroup = clientProjectGroups.find((group) =>
      group.projects.some((project) => project.tasks.some((task) => task.id === highlightedTaskId)),
    );
    if (!clientGroup) return;
    const projectGroup = clientGroup.projects.find((project) =>
      project.tasks.some((task) => task.id === highlightedTaskId),
    );
    if (!projectGroup) return;
    const projectCollapseKey = `${clientGroup.key}::${projectGroup.key}`;
    setCollapsedClients((prev) => {
      if (!prev.has(clientGroup.key)) return prev;
      const next = new Set(prev);
      next.delete(clientGroup.key);
      return next;
    });
    setCollapsedClientProjects((prev) => {
      if (!prev.has(projectCollapseKey)) return prev;
      const next = new Set(prev);
      next.delete(projectCollapseKey);
      return next;
    });
  }, [groupByClientProject, highlightedTaskId, clientProjectGroups]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
        <ClipboardList size={36} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  const allSelected =
    selectable &&
    selectedIds &&
    tasks.length > 0 &&
    tasks.every((task) => selectedIds.has(task.id));

  const hideProjectColumn = groupByClientProject;
  const hideDueDate = !showDueDate;
  const nestCheckboxUnderProject = groupByClientProject && selectable;
  const gridCols = listGridCols({
    selectable: selectable && !nestCheckboxUnderProject,
    hideProject: hideProjectColumn,
    hideDueDate,
  });
  const rowClass = `w-full grid ${gridCols} gap-x-4 gap-y-2 px-5 items-center`;

  const toggleStage = (stageKey: string) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageKey)) next.delete(stageKey);
      else next.add(stageKey);
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    if (!allowStageDrag) return;
    e.stopPropagation();
    didDragRef.current = true;
    setDraggedTask(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(taskId));
  };

  const handleDragOver = (e: React.DragEvent, stageKey: string) => {
    if (!allowStageDrag || draggedTask == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageKey);
  };

  const handleDrop = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    if (!allowStageDrag || draggedTask == null) return;

    const current = tasks.find((task) => task.id === draggedTask);
    const alreadyInStage =
      current &&
      tasksForPipelineColumn([current], stageKey).length > 0;

    if (!alreadyInStage) {
      updateMutation.mutate({
        id: draggedTask,
        stage: stageKey as ProjectPipelineStageKey,
      });
    }

    setDraggedTask(null);
    setDragOverStage(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverStage(null);
    requestAnimationFrame(() => {
      didDragRef.current = false;
    });
  };

  const isProjectUpdatePending = (taskId: number) =>
    updateMutation.isPending &&
    updateMutation.variables?.id === taskId &&
    updateMutation.variables.projectId !== undefined;

  const isPriorityUpdatePending = (taskId: number) =>
    updateMutation.isPending &&
    updateMutation.variables?.id === taskId &&
    updateMutation.variables.priority !== undefined;

  const isDueDateUpdatePending = (taskId: number) =>
    updateMutation.isPending &&
    updateMutation.variables?.id === taskId &&
    updateMutation.variables.dueDate !== undefined;

  const isAssigneeUpdatePending = (taskId: number) =>
    updateMutation.isPending &&
    updateMutation.variables?.id === taskId &&
    updateMutation.variables.assigneeId !== undefined;

  const toggleClient = (clientKey: string) => {
    setCollapsedClients((prev) => {
      const next = new Set(prev);
      if (next.has(clientKey)) next.delete(clientKey);
      else next.add(clientKey);
      return next;
    });
  };

  const toggleClientProject = (projectCollapseKey: string) => {
    setCollapsedClientProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectCollapseKey)) next.delete(projectCollapseKey);
      else next.add(projectCollapseKey);
      return next;
    });
  };

  const header = (
    <div className={`${rowClass} py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider`}>
      {selectable && !nestCheckboxUnderProject ? (
        <span className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
            className="h-4 w-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]/30"
            aria-label="Select all tasks"
          />
        </span>
      ) : null}
      <span
        className={cn(
          "whitespace-nowrap",
          nestCheckboxUnderProject && "inline-flex items-center gap-2 pl-[4.25rem]",
        )}
      >
        {selectable && nestCheckboxUnderProject ? (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
            className="h-4 w-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]/30"
            aria-label="Select all tasks"
          />
        ) : null}
        Task
      </span>
      {hideProjectColumn ? null : <span className="whitespace-nowrap">Project</span>}
      <span className="whitespace-nowrap">Assignee</span>
      <span className="whitespace-nowrap">Created by</span>
      <span className="whitespace-nowrap">Created</span>
      {hideDueDate ? null : <span className="whitespace-nowrap">Due Date</span>}
      <span className="whitespace-nowrap">Priority</span>
    </div>
  );

  if (groupByClientProject) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full">
        <div className="overflow-x-auto overscroll-x-contain">
          <div className={TABLE_MIN_WIDTH}>
            {header}
            {clientProjectGroups.map((clientGroup) => {
              const clientCollapsed = collapsedClients.has(clientGroup.key);
              return (
                <div key={clientGroup.key}>
                  <button
                    type="button"
                    onClick={() => toggleClient(clientGroup.key)}
                    className="w-full flex items-center gap-2.5 px-5 py-3 bg-[#F8FAFC] border-b border-gray-200 text-left hover:bg-[#F1F5F9] transition-colors dark:bg-[#111827] dark:hover:bg-[#1F2937]"
                    aria-expanded={!clientCollapsed}
                  >
                    <ChevronDown
                      size={16}
                      className={cn(
                        "text-gray-400 shrink-0 transition-transform",
                        clientCollapsed && "-rotate-90",
                      )}
                    />
                    <span className="text-sm font-semibold text-[#1F2937] truncate">
                      {clientGroup.clientName}
                    </span>
                    <span className="text-[11px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-full min-w-[22px] h-5 px-1.5 flex items-center justify-center">
                      {clientGroup.taskCount}
                    </span>
                    <span className="text-[11px] text-gray-400 truncate">
                      {clientGroup.projects.length}{" "}
                      {clientGroup.projects.length === 1 ? "project" : "projects"}
                    </span>
                  </button>

                  {!clientCollapsed
                    ? clientGroup.projects.map((projectGroup) => {
                        const projectCollapseKey = `${clientGroup.key}::${projectGroup.key}`;
                        const projectCollapsed = collapsedClientProjects.has(projectCollapseKey);
                        return (
                          <div key={projectCollapseKey}>
                            <button
                              type="button"
                              onClick={() => toggleClientProject(projectCollapseKey)}
                              className="w-full flex items-center gap-2 px-5 py-2.5 pl-12 bg-gray-50/80 border-b border-gray-200 text-left hover:bg-gray-100/80 transition-colors"
                              aria-expanded={!projectCollapsed}
                            >
                              <ChevronDown
                                size={15}
                                className={cn(
                                  "text-gray-400 shrink-0 transition-transform",
                                  projectCollapsed && "-rotate-90",
                                )}
                              />
                              {projectGroup.projectColor ? (
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: projectGroup.projectColor }}
                                />
                              ) : (
                                <FolderKanban size={14} className="text-gray-400 shrink-0" />
                              )}
                              <span className="text-[13px] font-medium text-[#374151] truncate">
                                {projectGroup.projectName}
                              </span>
                              <span className="text-[11px] font-semibold text-gray-500 bg-gray-200/80 rounded-full min-w-[22px] h-5 px-1.5 flex items-center justify-center">
                                {projectGroup.tasks.length}
                              </span>
                            </button>

                            {!projectCollapsed
                              ? projectGroup.tasks.map((task) => (
                                  <TaskListRow
                                    key={task.id}
                                    task={task}
                                    rowClass={rowClass}
                                    selectable={selectable}
                                    selectedIds={selectedIds}
                                    onToggleSelect={onToggleSelect}
                                    highlightedTaskId={highlightedTaskId}
                                    enableStageDrag={false}
                                    isDragging={false}
                                    onDragStart={handleDragStart}
                                    onDragEnd={handleDragEnd}
                                    didDragRef={didDragRef}
                                    onTaskClick={onTaskClick}
                                    allowProjectEdit={allowProjectEdit}
                                    allowFieldEdit={canEditTaskListFields(user, task)}
                                    projects={projects}
                                    projectUpdatePending={isProjectUpdatePending(task.id)}
                                    priorityUpdatePending={isPriorityUpdatePending(task.id)}
                                    dueDateUpdatePending={isDueDateUpdatePending(task.id)}
                                    onProjectChange={handleProjectChange}
                                    onPriorityChange={handlePriorityChange}
                                    onDueDateChange={handleDueDateChange}
                                    onAssigneeChange={handleAssigneeChange}
                                    assigneeUsers={assigneeUsers}
                                    assigneeUpdatePending={isAssigneeUpdatePending(task.id)}
                                    allowAssigneeEdit={canChangeTaskAssignee(
                                      user,
                                      task.assigneeId ?? task.assignee?.id,
                                    )}
                                    isTimerRunning={showTimeTracking && activeTimerTaskId === task.id}
                                    timerElapsedSeconds={
                                      activeTimerTaskId === task.id
                                        ? activeTimerElapsedSeconds
                                        : undefined
                                    }
                                    hideProjectColumn={hideProjectColumn}
                                    hideDueDate={hideDueDate}
                                    nestCheckboxUnderProject={nestCheckboxUnderProject}
                                  />
                                ))
                              : null}
                          </div>
                        );
                      })
                    : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (!groupByStage) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full">
        <div className="overflow-x-auto overscroll-x-contain">
          <div className={TABLE_MIN_WIDTH}>
            {header}
            {tasks.map((task) => (
          <TaskListRow
            key={task.id}
            task={task}
            rowClass={rowClass}
            selectable={selectable}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            highlightedTaskId={highlightedTaskId}
            enableStageDrag={false}
            isDragging={false}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            didDragRef={didDragRef}
            onTaskClick={onTaskClick}
            allowProjectEdit={allowProjectEdit}
            allowFieldEdit={canEditTaskListFields(user, task)}
            projects={projects}
            projectUpdatePending={isProjectUpdatePending(task.id)}
            priorityUpdatePending={isPriorityUpdatePending(task.id)}
            dueDateUpdatePending={isDueDateUpdatePending(task.id)}
            onProjectChange={handleProjectChange}
            onPriorityChange={handlePriorityChange}
            onDueDateChange={handleDueDateChange}
            onAssigneeChange={handleAssigneeChange}
            assigneeUsers={assigneeUsers}
            assigneeUpdatePending={isAssigneeUpdatePending(task.id)}
            allowAssigneeEdit={canChangeTaskAssignee(
              user,
              task.assigneeId ?? task.assignee?.id,
            )}
            isTimerRunning={showTimeTracking && activeTimerTaskId === task.id}
            timerElapsedSeconds={
              activeTimerTaskId === task.id ? activeTimerElapsedSeconds : undefined
            }
            hideProjectColumn={hideProjectColumn}
            hideDueDate={hideDueDate}
          />
        ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full">
      <div className="overflow-x-auto overscroll-x-contain">
        <div className={TABLE_MIN_WIDTH}>
      {header}

      {stageGroups.map((group) => {
        const collapsed = collapsedStages.has(group.key) && draggedTask == null;
        const isDragOver = dragOverStage === group.key;

        return (
          <div
            key={group.key}
            onDragOver={(e) => handleDragOver(e, group.key)}
            onDrop={(e) => handleDrop(e, group.key)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverStage((current) => (current === group.key ? null : current));
              }
            }}
            className={cn(
              "transition-colors",
              isDragOver && "bg-blue-50/60 ring-2 ring-inset ring-[#2563EB]/35",
            )}
          >
            <button
              type="button"
              onClick={() => toggleStage(group.key)}
              className="w-full flex items-center gap-2 px-5 py-2.5 bg-gray-50/90 border-b border-gray-200 text-left hover:bg-gray-100/80 transition-colors"
              aria-expanded={!collapsed}
            >
              <ChevronDown
                size={16}
                className={cn(
                  "text-gray-400 shrink-0 transition-transform",
                  collapsed && "-rotate-90",
                )}
              />
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: group.color }}
              />
              <span className="text-sm font-semibold text-[#1F2937]">{group.label}</span>
              <span className="text-[11px] font-semibold text-gray-500 bg-gray-200/80 rounded-full min-w-[22px] h-5 px-1.5 flex items-center justify-center">
                {group.tasks.length}
              </span>
            </button>

            {!collapsed ? (
              group.tasks.length === 0 ? (
                <div className="px-5 py-4 border-b border-dashed border-gray-200 text-xs text-gray-400 text-center">
                  {draggedTask != null ? "Drop a task here" : "No tasks"}
                </div>
              ) : (
                group.tasks.map((task) => (
                  <TaskListRow
                    key={task.id}
                    task={task}
                    rowClass={rowClass}
                    selectable={selectable}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    highlightedTaskId={highlightedTaskId}
                    enableStageDrag={allowStageDrag}
                    isDragging={draggedTask === task.id}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    didDragRef={didDragRef}
                    onTaskClick={onTaskClick}
                    allowProjectEdit={allowProjectEdit}
                    allowFieldEdit={canEditTaskListFields(user, task)}
                    projects={projects}
                    projectUpdatePending={isProjectUpdatePending(task.id)}
                    priorityUpdatePending={isPriorityUpdatePending(task.id)}
                    dueDateUpdatePending={isDueDateUpdatePending(task.id)}
                    onProjectChange={handleProjectChange}
                    onPriorityChange={handlePriorityChange}
                    onDueDateChange={handleDueDateChange}
                    onAssigneeChange={handleAssigneeChange}
                    assigneeUsers={assigneeUsers}
                    assigneeUpdatePending={isAssigneeUpdatePending(task.id)}
                    allowAssigneeEdit={canChangeTaskAssignee(
                      user,
                      task.assigneeId ?? task.assignee?.id,
                    )}
                    isTimerRunning={showTimeTracking && activeTimerTaskId === task.id}
                    timerElapsedSeconds={
                      activeTimerTaskId === task.id ? activeTimerElapsedSeconds : undefined
                    }
                    hideProjectColumn={hideProjectColumn}
                    hideDueDate={hideDueDate}
                  />
                ))
              )
            ) : null}
          </div>
        );
      })}
        </div>
      </div>
    </div>
  );
}
