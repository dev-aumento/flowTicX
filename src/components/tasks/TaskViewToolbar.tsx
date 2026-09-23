import { LayoutGrid, List } from "lucide-react";

export type TaskView = "list" | "kanban";

const MAIN_TABS: { id: TaskView; label: string; icon: typeof LayoutGrid }[] = [
  { id: "list", label: "List", icon: List },
  { id: "kanban", label: "Kanban", icon: LayoutGrid },
];

interface TaskViewToolbarProps {
  view: TaskView;
  onViewChange: (view: TaskView) => void;
}

export function TaskViewToolbar({ view, onViewChange }: TaskViewToolbarProps) {
  return (
    <div className="flex items-center gap-0.5 p-1 bg-gray-100 border border-gray-200 rounded-xl w-fit">
      {MAIN_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = view === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onViewChange(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              active
                ? "bg-white text-[#1F2937] shadow-sm"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <Icon size={14} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
