import { useNavigate } from "react-router";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { UserAvatar } from "@/components/shared/UserAvatar";
import {
  LeaveSummaryPanel,
  type LeaveSummaryItem,
} from "@/components/dashboard/LeaveSummaryPanel";
import {
  UpcomingBirthdaysPanel,
  type UpcomingBirthdayItem,
} from "@/components/dashboard/UpcomingBirthdaysPanel";

const DEPT_COLORS = ["#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#38BDF8", "#0EA5E9"];

type WorkforceOverviewData = {
  overviewStaffTotal?: number;
  byDepartment: Array<{ name: string; count: number; percent: number }>;
  leaveMonthLabel?: string;
  upcomingLeaves: LeaveSummaryItem[];
  upcomingWfh?: LeaveSummaryItem[];
  recentJoiners: Array<{
    id: number;
    name: string;
    avatar: string | null;
    position: string;
    joinedLabel: string;
  }>;
  upcomingBirthdays: UpcomingBirthdayItem[];
};

export function WorkforceOverviewPanels({
  data,
  className = "",
}: {
  data: WorkforceOverviewData | null | undefined;
  className?: string;
}) {
  const navigate = useNavigate();

  return (
    <div className={`space-y-5 ${className}`.trim()}>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-[#1F2937]">Work Overview</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4">Team by department / role</p>
          <div className="h-48 relative">
            <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-xl font-bold text-[#1F2937]">
                  {data?.overviewStaffTotal ??
                    (data?.byDepartment ?? []).reduce((sum, row) => sum + row.count, 0)}
                </div>
                <div className="text-[10px] text-gray-400">Total</div>
              </div>
            </div>
            <div className="relative z-10 h-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data?.byDepartment ?? []}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {(data?.byDepartment ?? []).map((_, i) => (
                      <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value}`, name]}
                    wrapperStyle={{ zIndex: 30, outline: "none" }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #E5E7EB",
                      backgroundColor: "#ffffff",
                      color: "#111827",
                      fontSize: 12,
                      opacity: 1,
                    }}
                    labelStyle={{ color: "#111827" }}
                    itemStyle={{ color: "#111827" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
            {(data?.byDepartment ?? []).map((row, i) => (
              <div key={row.name} className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: DEPT_COLORS[i % DEPT_COLORS.length] }}
                  />
                  <span className="text-gray-600 truncate">{row.name}</span>
                </div>
                <span className="text-gray-500 shrink-0">
                  {row.count} <span className="text-gray-400">({row.percent}%)</span>
                </span>
              </div>
            ))}
            {(data?.byDepartment ?? []).length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No department data yet</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => navigate("/admin/departments")}
            className="mt-4 w-full h-9 rounded-lg border border-gray-200 text-sm font-medium text-[#2563EB] hover:bg-blue-50 transition-colors dark:border-[#2d3a4f] dark:text-white dark:font-semibold dark:hover:bg-[#1a2336]"
          >
            View Report
          </button>
        </div>

        <LeaveSummaryPanel
          leaveMonthLabel={data?.leaveMonthLabel}
          upcomingLeaves={data?.upcomingLeaves ?? []}
          upcomingWfh={data?.upcomingWfh ?? []}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#1F2937]">Recent Joiners</h2>
            <button
              type="button"
              onClick={() => navigate("/admin/employees")}
              className="text-xs font-medium text-[#2563EB] hover:underline dark:text-white dark:font-semibold"
            >
              View All
            </button>
          </div>
          <div className="space-y-3">
            {(data?.recentJoiners ?? []).length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No recent joiners</p>
            ) : (
              (data?.recentJoiners ?? []).map((person) => (
                <div key={person.id} className="flex items-center gap-3">
                  <UserAvatar name={person.name} avatar={person.avatar} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#1F2937] truncate">
                      {person.name}
                    </div>
                    <div className="text-xs text-gray-400 truncate">{person.position}</div>
                  </div>
                  <div className="text-xs text-gray-400 shrink-0">Joined {person.joinedLabel}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <UpcomingBirthdaysPanel birthdays={data?.upcomingBirthdays ?? []} />
      </div>
    </div>
  );
}
