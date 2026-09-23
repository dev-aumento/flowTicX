import type { LucideIcon } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { cn, priorityConfig } from "@/lib/utils";

export const TASK_PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITY_OPTIONS)[number];

export function isTaskPriority(value: string): value is TaskPriority {
  return TASK_PRIORITY_OPTIONS.includes(value as TaskPriority);
}

const META_SELECT_CHEVRON =
  "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D%22http://www.w3.org/2000/svg%22 width%3D%2216%22 height%3D%2216%22 viewBox%3D%220 0 24 24%22 fill%3D%22none%22 stroke%3D%22%239CA3AF%22 stroke-width%3D%222%22 stroke-linecap%3D%22round%22 stroke-linejoin%3D%22round%22%3E%3Cpath d%3D%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')]";

export const META_SELECT_CLASS = cn(
  "h-9 w-full max-w-[240px] rounded-lg border border-gray-200 bg-white px-3 pr-9",
  "text-sm text-gray-800 appearance-none bg-no-repeat bg-[length:16px] bg-[right_0.7rem_center]",
  META_SELECT_CHEVRON,
);

export const META_DATETIME_CLASS = cn(
  "h-9 w-full max-w-[240px] rounded-lg border border-gray-200 bg-white px-3",
  "text-sm text-gray-800 [color-scheme:light] dark:[color-scheme:dark]",
  "[&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer",
  "[&::-webkit-datetime-edit]:leading-9 [&::-webkit-datetime-edit-fields-wrapper]:p-0",
);

export function PriorityMetaSelect({
  value,
  onChange,
  disabled,
}: {
  value: TaskPriority;
  onChange: (value: TaskPriority) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        if (isTaskPriority(next)) onChange(next);
      }}
      className={META_SELECT_CLASS}
    >
      {TASK_PRIORITY_OPTIONS.map((priority) => (
        <option key={priority} value={priority}>
          {priorityConfig[priority].label}
        </option>
      ))}
    </select>
  );
}

export function TaskMetaRow({
  label,
  icon: Icon,
  children,
  align = "center",
}: {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[16px_6.75rem_minmax(0,1fr)] gap-x-3 py-2.5 border-b border-gray-100 last:border-0",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      {Icon ? (
        <Icon size={16} className="shrink-0 text-gray-400" />
      ) : (
        <span />
      )}
      <span className="text-sm text-gray-500 leading-none">{label}:</span>
      <div
        className={cn(
          "min-w-0",
          align === "center" ? "flex items-center" : "flex items-start pt-1.5",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function TaskUserChip({ name, avatar }: { name?: string | null; avatar?: string | null }) {
  if (!name) return <span className="text-gray-400">—</span>;
  return (
    <span className="inline-flex items-center gap-2 text-gray-800">
      <UserAvatar name={name} avatar={avatar} size={22} />
      {name}
    </span>
  );
}

export function TaskSectionCard({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-gray-200 bg-white overflow-hidden", className)}>
      {title && (
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{title}</span>
        </div>
      )}
      {children}
    </section>
  );
}
