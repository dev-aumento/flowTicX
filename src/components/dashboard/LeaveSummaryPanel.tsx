import { useMemo } from "react";
import { useNavigate } from "react-router";
import { UserAvatar } from "@/components/shared/UserAvatar";

export type LeaveSummaryItem = {
  id: string;
  avatar: string | null;
  dateKey: string;
  section: "today" | "tomorrow" | "upcoming";
  name: string;
  leaveTypeLabel: string;
};

function groupBySection(items: LeaveSummaryItem[], options?: { keepEmpty?: boolean }) {
  const sections = [
    { key: "today" as const, label: "Today", items: items.filter((l) => l.section === "today") },
    {
      key: "tomorrow" as const,
      label: "Tomorrow",
      items: items.filter((l) => l.section === "tomorrow"),
    },
    {
      key: "upcoming" as const,
      label: "Upcoming",
      items: items.filter((l) => l.section === "upcoming"),
    },
  ];
  if (options?.keepEmpty) return sections;
  return sections.filter((section) => section.items.length > 0);
}

function formatLeaveDate(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  const year = dateKey.slice(0, 4);
  return `${day}-${month}-${year}`;
}

function SummaryColumn({
  title,
  emptyLabel,
  sections,
  mode,
  showLeaveType,
}: {
  title: string;
  emptyLabel: string;
  sections: ReturnType<typeof groupBySection>;
  mode: "leave" | "wfh";
  /** Admin/HR only — employees see date without leave type. */
  showLeaveType: boolean;
}) {
  const hasAny = sections.some((s) => s.items.length > 0);
  // WFH always shows Today / Tomorrow / Upcoming headers (same structure as leaves).
  const showSections = mode === "wfh" || hasAny;

  const detailLine = (item: LeaveSummaryItem) => {
    const date = formatLeaveDate(item.dateKey);
    if (!showLeaveType) return date;
    if (mode === "wfh") return `${date} - WFH`;
    return `${date} - ${item.leaveTypeLabel} leave`;
  };

  return (
    <div className="min-w-0 flex flex-col">
      <p className="text-xs font-medium text-gray-500 mb-3 font-semibold">{title}</p>
      <div className="flex-1 space-y-4 overflow-y-auto max-h-56 pr-1">
        {!showSections ? (
          <p className="text-xs text-gray-400 text-center py-8">{emptyLabel}</p>
        ) : (
          sections
            .filter((section) => mode === "wfh" || section.items.length > 0)
            .map((section) => (
            <div key={section.key} className="space-y-2">
              <h3 className="text-[11px] font-semibold capitalize tracking-wide text-gray-500">
                {section.label}
              </h3>
              {section.items.length === 0 ? (
                <p className="text-xs text-gray-400 pl-1">None</p>
              ) : (
                <div className="space-y-3">
                  {section.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <UserAvatar name={item.name} avatar={item.avatar} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[#1F2937] truncate">
                          {item.name}
                        </div>
                        <div className="text-xs text-gray-400">{detailLine(item)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function LeaveSummaryPanel({
  leaveMonthLabel,
  upcomingLeaves,
  upcomingWfh = [],
  className = "",
  /** When true, links go to /leaves and leave type is hidden. */
  employeeView = false,
}: {
  leaveMonthLabel?: string;
  upcomingLeaves: LeaveSummaryItem[];
  upcomingWfh?: LeaveSummaryItem[];
  className?: string;
  employeeView?: boolean;
}) {
  const navigate = useNavigate();
  const calendarPath = employeeView ? "/leaves" : "/leave-management";
  const showLeaveType = !employeeView;

  const leaveSections = useMemo(
    () => groupBySection(upcomingLeaves, { keepEmpty: true }),
    [upcomingLeaves],
  );
  const wfhSections = useMemo(
    () => groupBySection(upcomingWfh, { keepEmpty: true }),
    [upcomingWfh],
  );

  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-5 flex flex-col ${className}`.trim()}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-[#1F2937]">Leave Summary</h2>
        <button
          type="button"
          onClick={() => navigate(calendarPath)}
          className="text-[11px] font-medium text-[#2563EB] hover:underline dark:text-white dark:font-semibold"
        >
          Leave Calendar
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Upcoming Leaves & WFH — {leaveMonthLabel ?? ""}
      </p>

      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6 min-h-0">
        <SummaryColumn
          title="On leave"
          emptyLabel="No upcoming leaves"
          sections={leaveSections}
          mode="leave"
          showLeaveType={showLeaveType}
        />
        <div className="min-w-0 sm:border-l sm:border-gray-100 sm:pl-6">
          <SummaryColumn
            title="Work from home"
            emptyLabel="No upcoming WFH"
            sections={wfhSections}
            mode="wfh"
            showLeaveType={showLeaveType}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate(calendarPath)}
        className="mt-4 text-sm font-medium text-[#2563EB] hover:underline text-left dark:text-white dark:font-semibold"
      >
        View Full Calendar →
      </button>
    </div>
  );
}

