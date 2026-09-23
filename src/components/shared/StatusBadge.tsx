import { statusConfig, priorityConfig, roleConfig } from "@/lib/utils";
import { useTaskStatusLabels } from "@/hooks/useTaskStatusLabels";
import { dbStatusLabel } from "@/lib/task-status-labels";

interface StatusBadgeProps {
  status: keyof typeof statusConfig;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const labels = useTaskStatusLabels();
  const config = statusConfig[status] ?? statusConfig.todo;
  const padding = size === "sm" ? "px-2.5 py-0.5" : "px-3 py-1";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${padding} ${textSize}`}
      style={{ backgroundColor: config.bg, color: config.color }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {dbStatusLabel(status, labels)}
    </span>
  );
}

interface PriorityBadgeProps {
  priority: keyof typeof priorityConfig;
  size?: "sm" | "md";
}

export function PriorityBadge({ priority, size = "sm" }: PriorityBadgeProps) {
  const config = priorityConfig[priority];
  const padding = size === "sm" ? "px-2.5 py-0.5" : "px-3 py-1";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${padding} ${textSize}`}
      style={{ backgroundColor: config.bg, color: config.color }}
    >
      {config.label}
    </span>
  );
}

interface RoleBadgeProps {
  role: string;
  size?: "sm" | "md";
}

export function RoleBadge({ role, size = "sm" }: RoleBadgeProps) {
  const config =
    role && role in roleConfig
      ? roleConfig[role as keyof typeof roleConfig]
      : roleConfig.employee;
  const padding = size === "sm" ? "px-2.5 py-0.5" : "px-3 py-1";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ${padding} ${textSize}`}
      style={{ backgroundColor: config.bg, color: config.color }}
    >
      {config.label}
    </span>
  );
}
