import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectSearchSelect } from "@/components/tasks/ProjectSearchSelect";
import { useTaskStatusLabels } from "@/hooks/useTaskStatusLabels";
import { taskBulkStatusOptions } from "@/lib/task-status-labels";

type TaskStatus = "todo" | "in_progress" | "review" | "done";

const bulkSelectTriggerClass =
  "h-9 min-w-[140px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-none hover:bg-gray-50 focus-visible:ring-[#2563EB]/20 focus-visible:border-[#2563EB]";

const bulkSelectContentClass =
  "rounded-xl border border-gray-200 bg-white shadow-lg p-1";

const bulkSelectItemClass =
  "rounded-lg text-sm text-gray-700 focus:bg-blue-50 focus:text-[#2563EB] data-[state=checked]:bg-blue-50 data-[state=checked]:text-[#2563EB] data-[state=checked]:font-medium dark:text-white dark:focus:bg-[#ffffff0d] dark:focus:text-white dark:data-[highlighted]:bg-[#ffffff0d] dark:data-[highlighted]:text-white dark:data-[state=checked]:bg-[#ffffff0d] dark:data-[state=checked]:text-white";

interface TaskBulkActionBarProps {
  selectedCount: number;
  canBulkEdit: boolean;
  canBulkDelete: boolean;
  projects: Array<{ id: number; name: string; color?: string | null }>;
  excludeProjectId?: number;
  isPending?: boolean;
  onChangeStatus: (status: TaskStatus) => void;
  onMoveProject: (projectId: number | null) => void;
  onDelete: () => void;
  onClear: () => void;
}

export function TaskBulkActionBar({
  selectedCount,
  canBulkEdit,
  canBulkDelete,
  projects,
  excludeProjectId,
  isPending,
  onChangeStatus,
  onMoveProject,
  onDelete,
  onClear,
}: TaskBulkActionBarProps) {
  const [bulkStatus, setBulkStatus] = useState<TaskStatus>("todo");
  const statusLabels = useTaskStatusLabels();
  const statusOptions = taskBulkStatusOptions(statusLabels);
  // undefined = not chosen yet; null = No project; number = project id
  const [moveProjectId, setMoveProjectId] = useState<number | null | undefined>(undefined);

  const moveProjects = useMemo(
    () => projects.filter((p) => p.id !== excludeProjectId),
    [projects, excludeProjectId],
  );

  if (selectedCount === 0 || (!canBulkEdit && !canBulkDelete)) {
    return null;
  }

  return (
    <div className="sticky top-[4.25rem] z-30 flex flex-wrap items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl shadow-sm">
      <span className="text-sm font-medium text-[#1F2937]">
        {selectedCount} selected
      </span>

      {canBulkEdit ? (
        <>
          <Select
            value={bulkStatus}
            onValueChange={(value) => setBulkStatus(value as TaskStatus)}
          >
            <SelectTrigger className={bulkSelectTriggerClass} size="default">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent className={bulkSelectContentClass} position="popper" align="start">
              {statusOptions.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  className={bulkSelectItemClass}
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            disabled={isPending}
            onClick={() => onChangeStatus(bulkStatus)}
            className="h-9 px-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Change status
          </button>

          <ProjectSearchSelect
            projects={moveProjects}
            value={typeof moveProjectId === "number" ? moveProjectId : null}
            onValueChange={(id) => {
              // Clear option => no project (null). Project id => that project.
              setMoveProjectId(id === undefined ? null : id);
            }}
            placeholder={moveProjectId === null ? "No project" : "Move to project…"}
            clearLabel="No project"
            searchPlaceholder="Search projects…"
            allowClear
            containerClassName="w-auto max-w-[240px] shrink-0"
            triggerClassName="rounded-xl max-w-[240px] font-medium text-gray-700 shadow-none"
          />
          <button
            type="button"
            disabled={isPending || moveProjectId === undefined}
            onClick={() => onMoveProject(moveProjectId ?? null)}
            className="h-9 px-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Move
          </button>
        </>
      ) : null}

      {canBulkDelete ? (
        <button
          type="button"
          disabled={isPending}
          onClick={onDelete}
          className="h-9 px-3 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <Trash2 size={14} />
          Delete
        </button>
      ) : null}

      <button
        type="button"
        onClick={onClear}
        className="h-9 px-3 text-sm text-gray-600 hover:text-gray-800"
      >
        Clear
      </button>
    </div>
  );
}
