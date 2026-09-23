import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TASK_ROLE_OPTIONS,
  type TaskRoleFilter,
} from "@/lib/task-role-filter";

function RoleCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#F59E0B] text-white text-[11px] font-bold flex items-center justify-center">
      {count}
    </span>
  );
}

interface TaskRoleFilterDropdownProps {
  value: TaskRoleFilter;
  onChange: (value: TaskRoleFilter) => void;
  counts: Record<TaskRoleFilter, number>;
}

export function TaskRoleFilterDropdown({
  value,
  onChange,
  counts,
}: TaskRoleFilterDropdownProps) {
  const selectedLabel =
    TASK_ROLE_OPTIONS.find((o) => o.id === value)?.label ?? "All roles";
  const triggerCount = counts[value];

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="h-9 pl-3 pr-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-[#1F2937] flex items-center gap-2 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
        >
          <span>{selectedLabel}</span>
          <RoleCountBadge count={triggerCount} />
          <ChevronDown size={14} className="text-gray-400 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-[220px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
      >
        {TASK_ROLE_OPTIONS.map((option) => {
          const selected = value === option.id;
          const count = counts[option.id];

          return (
            <DropdownMenuItem
              key={option.id}
              onClick={() => onChange(option.id)}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer ${
                selected
                  ? "bg-gray-50 text-[#1F2937] font-medium"
                  : "text-gray-700"
              }`}
            >
              <span>{option.label}</span>
              <span className="flex items-center gap-2 shrink-0">
                <RoleCountBadge count={count} />
                {selected && <Check size={16} className="text-[#2563EB]" />}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
