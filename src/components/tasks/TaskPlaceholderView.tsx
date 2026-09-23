import { CalendarDays, GanttChart, LayoutList } from "lucide-react";

const ICONS = {
  planner: LayoutList,
  calendar: CalendarDays,
  gantt: GanttChart,
} as const;

interface TaskPlaceholderViewProps {
  view: "planner" | "calendar" | "gantt";
}

export function TaskPlaceholderView({ view }: TaskPlaceholderViewProps) {
  const Icon = ICONS[view];
  const label = view.charAt(0).toUpperCase() + view.slice(1);

  return (
    <div className="bg-white border border-gray-200 rounded-xl py-20 text-center">
      <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
        <Icon size={28} className="text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-[#1F2937] mb-1">{label} view</h3>
      <p className="text-sm text-gray-500 max-w-sm mx-auto">
        {label} scheduling is coming soon. Use List or Deadline views for now.
      </p>
    </div>
  );
}
