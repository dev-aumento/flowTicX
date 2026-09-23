import { Link } from "react-router";
import { ArrowLeft, LayoutGrid, List, Pencil, Plus, Search, X } from "lucide-react";
import { FilterSelect } from "@/components/shared/FilterSelect";
import { cn } from "@/lib/utils";

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

type ProjectKanbanHeaderProps = {
  name: string;
  clientName?: string | null;
  totalTasks: number;
  doneTasks: number;
  search: string;
  onSearchChange: (value: string) => void;
  priority: string;
  onPriorityChange: (value: string) => void;
  canCreate?: boolean;
  onAddTask?: () => void;
  canEdit?: boolean;
  onEdit?: () => void;
  backTo?: string;
  taskView: "list" | "kanban";
  onTaskViewChange: (view: "list" | "kanban") => void;
};

export function ProjectKanbanHeader({
  name,
  clientName,
  totalTasks,
  doneTasks,
  search,
  onSearchChange,
  priority,
  onPriorityChange,
  canCreate,
  onAddTask,
  canEdit,
  onEdit,
  backTo = "/projects",
  taskView,
  onTaskViewChange,
}: ProjectKanbanHeaderProps) {
  const agency = clientName?.trim() || "";

  const taskCountLabel = `${totalTasks} ${totalTasks === 1 ? "task" : "tasks"} · ${doneTasks} done`;

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
      <div className="flex items-start gap-2 min-w-0 w-full xl:flex-1">
        <Link
          to={backTo}
          className="mt-0.5 shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:text-[#2563EB] hover:bg-blue-50 dark:hover:bg-white/10 dark:hover:text-white transition-colors"
          aria-label="Back to projects"
          title="Back to projects"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="min-w-0 flex-1 text-xl sm:text-[22px] font-bold text-[#111827] dark:text-white leading-tight truncate">
              {name}
            </h1>
            {agency ? (
              <span className="hidden sm:inline-flex items-center h-6 px-2 rounded-full bg-gray-100 dark:bg-white/10 text-[12px] font-medium text-gray-600 dark:text-gray-300 truncate max-w-[9rem] md:max-w-[14rem] shrink-0">
                {agency}
              </span>
            ) : null}
            {canEdit && onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-white/10 dark:hover:text-white shrink-0"
                aria-label="Edit project"
                title="Edit project"
              >
                <Pencil size={13} />
              </button>
            ) : null}
          </div>
          <p
            className="mt-1 text-[13px] text-gray-500 dark:text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis"
            title={taskCountLabel}
          >
            {taskCountLabel}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 w-full min-w-0 xl:w-auto xl:max-w-[min(100%,40rem)] xl:justify-end xl:pt-0.5">
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-white/10 shrink-0">
          <button
            type="button"
            onClick={() => onTaskViewChange("list")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 px-2.5 rounded-md text-sm font-medium transition-colors",
              taskView === "list"
                ? "bg-white text-[#111827] shadow-sm dark:bg-[#3A3B3E] dark:text-white"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white",
            )}
            aria-label="List view"
            title="List view"
          >
            <List size={15} />
            <span className="hidden min-[380px]:inline">List</span>
          </button>
          <button
            type="button"
            onClick={() => onTaskViewChange("kanban")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 px-2.5 rounded-md text-sm font-medium transition-colors",
              taskView === "kanban"
                ? "bg-white text-[#111827] shadow-sm dark:bg-[#3A3B3E] dark:text-white"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white",
            )}
            aria-label="Kanban view"
            title="Kanban view"
          >
            <LayoutGrid size={15} />
            <span className="hidden min-[380px]:inline">Kanban</span>
          </button>
        </div>

        <div className="relative min-w-0 flex-1 basis-[10rem] sm:flex-none sm:basis-auto sm:w-[200px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-8 text-sm text-[#111827] placeholder:text-gray-400 outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 dark:border-[#3D3E40] dark:bg-[#2A2B2D] dark:text-white"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <FilterSelect
          value={priority}
          onChange={onPriorityChange}
          options={PRIORITY_OPTIONS}
          aria-label="Filter by priority"
          triggerClassName="h-9 w-[min(100%,10.5rem)] sm:w-[148px] rounded-lg px-3 text-sm text-gray-600 dark:border-[#3D3E40] dark:bg-[#2A2B2D] dark:text-gray-300"
        />

        {canCreate && onAddTask ? (
          <button
            type="button"
            onClick={onAddTask}
            className="h-9 px-3 sm:px-3.5 bg-[#2563EB] text-white rounded-lg text-sm font-semibold hover:bg-[#1D4ED8] inline-flex items-center gap-1.5 shrink-0"
          >
            <Plus size={15} />
            <span className="hidden min-[380px]:inline">Add task</span>
            <span className="min-[380px]:hidden">Add</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
