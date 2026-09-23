import { Link } from "react-router";
import {
  ArrowLeft,
  CheckSquare,
  Users,
  Plus,
  Pencil,
  UserPlus,
  Loader2,
} from "lucide-react";

type ProjectStats = {
  total: number;
};

interface ProjectHeaderCardProps {
  name: string;
  description?: string | null;
  clientName?: string | null;
  stats: ProjectStats;
  memberCount: number;
  creatorName?: string | null;
  canEdit?: boolean;
  onEdit?: () => void;
  onAddTask?: () => void;
  onJoinProject?: () => void;
  joinPending?: boolean;
  canViewTasks?: boolean;
  backTo?: string;
  backLabel?: string;
}

export function ProjectHeaderCard({
  name,
  description,
  clientName,
  stats,
  memberCount,
  creatorName,
  canEdit,
  onEdit,
  onAddTask,
  onJoinProject,
  joinPending,
  canViewTasks = true,
  backTo = "/projects",
  backLabel = "Back to projects",
}: ProjectHeaderCardProps) {
  const total = canViewTasks ? stats.total || 0 : 0;
  const hasActions = Boolean(onJoinProject || (canEdit && onEdit) || onAddTask);

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 dark:bg-[#151c2c] dark:border-[#2d3a4f]">
      <div className="flex items-start gap-2.5">
        <Link
          to={backTo}
          className="mt-0.5 shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:text-[#2563EB] hover:bg-blue-50 transition-colors dark:text-gray-300 dark:hover:bg-[#1a2740]"
          aria-label={backLabel}
          title={backLabel}
        >
          <ArrowLeft size={18} />
        </Link>

        <div className="min-w-0 flex-1 flex flex-col gap-2">
          <div className="min-w-0">
            <div className="min-w-0 overflow-x-auto">
              <div className="flex items-baseline gap-x-2 whitespace-nowrap">
                <h1 className="text-[15px] sm:text-lg font-bold text-[#1F2937] leading-tight dark:text-gray-100">
                  {name}
                </h1>
                {clientName?.trim() ? (
                  <span className="text-sm text-gray-500 dark:text-gray-300">
                    · {clientName.trim()}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-1.5 flex flex-col gap-1 text-xs text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1 dark:text-gray-300">
              {creatorName ? (
                <span className="inline-flex items-center gap-1 min-w-0">
                  <Users size={13} className="text-gray-400 shrink-0 dark:text-gray-400" />
                  <span className="break-words">Created by {creatorName}</span>
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 shrink-0">
                <CheckSquare size={13} className="text-gray-400 dark:text-gray-400" />
                {canViewTasks ? `${total} Tasks` : "Join to view tasks"}
              </span>
              <span className="inline-flex items-center gap-1 shrink-0">
                <Users size={13} className="text-gray-400 dark:text-gray-400" />
                {memberCount} Members
              </span>
            </div>

            {description?.trim() ? (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2 sm:line-clamp-1 dark:text-gray-300">
                {description.trim()}
              </p>
            ) : null}
          </div>

          {hasActions ? (
            <div className="flex flex-wrap items-center gap-2">
              {onJoinProject ? (
                <button
                  type="button"
                  onClick={onJoinProject}
                  disabled={joinPending}
                  className="h-8 px-3 bg-[#2563EB] text-white rounded-lg text-sm font-semibold hover:bg-[#1D4ED8] flex items-center gap-1.5 disabled:opacity-50"
                >
                  {joinPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <UserPlus size={14} />
                  )}
                  Join Project
                </button>
              ) : null}
              {canEdit && onEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  className="h-8 px-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 dark:border-[#2d3a4f] dark:text-gray-300 dark:hover:bg-[#1a2740]"
                >
                  <Pencil size={13} />
                  Edit Project
                </button>
              ) : null}
              {onAddTask ? (
                <button
                  type="button"
                  onClick={onAddTask}
                  className="h-8 px-3 bg-[#2563EB] text-white rounded-lg text-sm font-semibold hover:bg-[#1D4ED8] flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  Add Task
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
