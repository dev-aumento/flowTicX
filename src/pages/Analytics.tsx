import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ActiveClockInsDialog } from "@/components/admin/ActiveClockInsDialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { motion } from "framer-motion";
import { BarChart3, Users, Clock, CheckCircle2, Loader2 } from "lucide-react";

const COLORS = ["#0EA5E9", "#2563EB", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];

const WORKLOAD_Y_AXIS_WIDTH = 130;

/** Single-line Y-axis labels — prevents Recharts from wrapping names at spaces. */
function WorkloadNameTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const fullName = payload?.value ?? "";
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{fullName}</title>
      <text
        x={-4}
        y={0}
        dy={4}
        textAnchor="end"
        fill="#9CA3AF"
        fontSize={11}
        style={{ whiteSpace: "nowrap" }}
      >
        {fullName.length > 16 ? `${fullName.slice(0, 15)}…` : fullName}
      </text>
    </g>
  );
}

export default function Analytics({ embedded = false }: { embedded?: boolean }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [clockInsOpen, setClockInsOpen] = useState(false);
  const { data: workload, isLoading: workloadLoading } = trpc.dashboard.getWorkload.useQuery();
  const { data: adminStats } = trpc.dashboard.getAdminStats.useQuery();
  const { data: taskStatusData = [] } = trpc.dashboard.getAssignedTaskStatusCounts.useQuery();

  const workloadChartHeight = useMemo(() => {
    const rows = workload?.length ?? 0;
    return Math.max(224, rows * 36 + 40);
  }, [workload?.length]);

  const weeklyCompletion = [
    { day: "Mon", completed: 3, created: 5 },
    { day: "Tue", completed: 2, created: 3 },
    { day: "Wed", completed: 4, created: 2 },
    { day: "Thu", completed: 1, created: 4 },
    { day: "Fri", completed: 3, created: 3 },
    { day: "Sat", completed: 0, created: 0 },
    { day: "Sun", completed: 0, created: 0 },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  };

  const stats = adminStats
    ? [
        { label: "Employees", value: adminStats.totalEmployees, icon: Users },
        { label: "Active Projects", value: adminStats.activeProjects, icon: CheckCircle2 },
        { label: "Total Tasks", value: adminStats.totalTasks, icon: BarChart3 },
        {
          label: "Active Clock-Ins",
          value: adminStats.activeClockIns,
          icon: Clock,
          onClick: () => setClockInsOpen(true),
        },
      ]
    : [];

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {!embedded ? (
        <motion.div variants={itemVariants}>
          <h1 className="text-2xl font-bold text-[#1F2937]">Reports & Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Employee data, attendance, and team workload</p>
        </motion.div>
      ) : null}

      {adminStats && (
        <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {stats.map((stat) => {
            if ("onClick" in stat && stat.onClick) {
              return (
                <button
                  key={stat.label}
                  type="button"
                  onClick={stat.onClick}
                  className="bg-white border border-gray-200 rounded-xl p-4 text-left transition-shadow hover:shadow-md cursor-pointer hover:border-[#2563EB]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <stat.icon size={16} className="text-[#2563EB]" />
                    <span className="text-xs text-gray-500">{stat.label}</span>
                  </div>
                  <div className="text-xl font-bold text-[#1F2937]">{stat.value}</div>
                  <div className="text-[11px] text-[#2563EB] mt-1 dark:text-white">View employees</div>
                </button>
              );
            }

            return (
              <div
                key={stat.label}
                className="bg-white border border-gray-200 rounded-xl p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={16} className="text-[#2563EB]" />
                  <span className="text-xs text-gray-500">{stat.label}</span>
                </div>
                <div className="text-xl font-bold text-[#1F2937]">{stat.value}</div>
              </div>
            );
          })}
        </motion.div>
      )}

      <ActiveClockInsDialog open={clockInsOpen} onOpenChange={setClockInsOpen} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-[#1F2937]">Team Workload</h2>
            <p className="text-xs text-gray-400 mt-0.5">Hours logged this week</p>
          </div>
          {workloadLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="h-56 overflow-y-auto">
              <div style={{ height: workloadChartHeight, minHeight: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={workload || []}
                    layout="vertical"
                    margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#c2c2c2" strokeOpacity={1} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={WORKLOAD_Y_AXIS_WIDTH}
                      interval={0}
                      tick={<WorkloadNameTick />}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
                      formatter={(value) => [`${value}h`, "Hours this week"]}
                      labelFormatter={(label) => String(label)}
                    />
                    <Bar dataKey="hoursLogged" fill="#2563EB" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </motion.div>

        <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-[#1F2937] mb-4">Task Status</h2>
          <div className="h-56 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={taskStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {taskStatusData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-4 mt-2">
            {taskStatusData.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index] }} />
                <span className="text-xs text-gray-500">{entry.name} ({entry.value})</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#1F2937]">Task Completion Trend</h2>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {(["week", "month"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${period === p ? "bg-white text-[#2563EB] shadow-sm" : "text-gray-500"}`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyCompletion}>
                <CartesianGrid strokeDasharray="3 3" stroke="#c2c2c2" strokeOpacity={1} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }} />
                <Line type="monotone" dataKey="completed" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 4 }} name="Completed" />
                <Line type="monotone" dataKey="created" stroke="#2563EB" strokeWidth={2} dot={{ r: 4 }} name="Created" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {workload && workload.length > 0 && (
        <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-[#1F2937]">Team Member Details</h2>
            <p className="text-xs text-gray-400 mt-0.5">Hours logged this week</p>
          </div>
          <div className="divide-y divide-gray-50">
            {workload.map((member) => (
              <div key={member.userId} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                <UserAvatar name={member.name} avatar={member.avatar} size={36} />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[#1F2937]">{member.name}</div>
                  <div className="text-xs text-gray-400 capitalize">{member.role}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-[#1F2937]">{member.hoursLogged}h</div>
                  <div className="text-xs text-gray-400">{member.taskCount} active tasks</div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
