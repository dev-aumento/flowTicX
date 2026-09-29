import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import type { DateRange } from "react-day-picker";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CalendarRange,
  ChevronDown,
  Clock,
  FileText,
  Paintbrush,
  Sparkles,
  TrendingUp,
  UserMinus,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  dashboardQueryOptions,
  DASHBOARD_REFRESH_EVENT,
  refreshDashboardPage,
} from "@/lib/dashboard-refresh";
import {
  formatWorkZoneDate,
  istTimeOfDayGreeting,
  workZoneDateKey,
  workZoneDateParts,
} from "@/lib/timezone";
import { formatHoursMinutes } from "@/lib/work-hours-policy";
import { formatMoney, currencySymbol } from "@/lib/invoice-store";
import { hasPlanFeature } from "@/lib/plan-features";
import { WorkforceKpiCards } from "@/components/dashboard/WorkforceKpiCards";
import { DashboardCalendarEventsBlocks } from "@/components/dashboard/DashboardCalendarPanel";
import { UpcomingBirthdaysPanel } from "@/components/dashboard/UpcomingBirthdaysPanel";
import { AdminDashboardMyTasks } from "@/components/dashboard/AdminDashboardMyTasks";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WORK_COLORS = ["#3B82F6", "#60A5FA", "#38BDF8", "#22D3EE", "#818CF8", "#0EA5E9"];

const CUSTOMIZE_STORAGE_KEY = "admin-dashboard-layout-v1";

type DashboardSectionId =
  | "workforceKpis"
  | "workOverview"
  | "projectOverview"
  | "aiBrief"
  | "monthMetrics"
  | "recentJoiners"
  | "birthdays"
  | "myTasks"
  | "calendar";

const DEFAULT_SECTIONS: Record<DashboardSectionId, boolean> = {
  workforceKpis: true,
  workOverview: true,
  projectOverview: true,
  aiBrief: true,
  monthMetrics: true,
  recentJoiners: true,
  birthdays: true,
  myTasks: true,
  calendar: true,
};

const SECTION_LABELS: Array<{ id: DashboardSectionId; label: string }> = [
  { id: "workforceKpis", label: "Workforce KPIs" },
  { id: "workOverview", label: "Work overview" },
  { id: "projectOverview", label: "Project overview" },
  { id: "aiBrief", label: "AI daily brief" },
  { id: "monthMetrics", label: "Hours and revenue" },
  { id: "myTasks", label: "My tasks" },
  { id: "calendar", label: "Calendar" },
];

type DatePresetId = "today" | "this_month" | "this_quarter" | "this_year" | "last_30" | "custom";

function keyToLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function startOfMonthKey(parts = workZoneDateParts(new Date())) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-01`;
}

function startOfQuarterKey(parts = workZoneDateParts(new Date())) {
  const quarterStartMonth = Math.floor((parts.month - 1) / 3) * 3 + 1;
  return `${parts.year}-${String(quarterStartMonth).padStart(2, "0")}-01`;
}

function startOfYearKey(parts = workZoneDateParts(new Date())) {
  return `${parts.year}-01-01`;
}

function shiftDaysKey(key: string, deltaDays: number) {
  const date = keyToLocalDate(key);
  date.setDate(date.getDate() + deltaDays);
  return workZoneDateKey(date);
}

function resolvePresetRange(preset: DatePresetId): { startDate: string; endDate: string } {
  const today = workZoneDateKey(new Date());
  switch (preset) {
    case "today":
      return { startDate: today, endDate: today };
    case "this_quarter":
      return { startDate: startOfQuarterKey(), endDate: today };
    case "last_30":
      return { startDate: shiftDaysKey(today, -29), endDate: today };
    case "this_year":
      return { startDate: startOfYearKey(), endDate: today };
    case "this_month":
    default:
      return { startDate: startOfMonthKey(), endDate: today };
  }
}

function loadSectionVisibility(): Record<DashboardSectionId, boolean> {
  try {
    const raw = localStorage.getItem(CUSTOMIZE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SECTIONS };
    const parsed = JSON.parse(raw) as Partial<Record<DashboardSectionId, boolean>>;
    return { ...DEFAULT_SECTIONS, ...parsed };
  } catch {
    return { ...DEFAULT_SECTIONS };
  }
}

function formatRangeLabel(startDate: string, endDate: string) {
  const opts = { day: "numeric", month: "short", year: "numeric" } as const;
  const start = formatWorkZoneDate(keyToLocalDate(startDate), opts);
  const end = formatWorkZoneDate(keyToLocalDate(endDate), opts);
  return startDate === endDate ? start : `${start} – ${end}`;
}

function projectStatusColor(name: string) {
  const n = name.toLowerCase();
  if (n.includes("overdue")) return "#EF4444";
  if (n.includes("hold")) return "#FBBF24";
  if (n.includes("progress")) return "#22D3EE";
  if (n.includes("complete") || n.includes("done")) return "#3B82F6";
  return "#64748B";
}

function TrendText({
  value,
  suffix,
  positiveIsGood = true,
}: {
  value: number;
  suffix: string;
  positiveIsGood?: boolean;
}) {
  if (value === 0) {
    return <span className="text-[11px] font-medium text-gray-400 dark:text-slate-500">No change {suffix}</span>;
  }
  const up = value > 0;
  const good = positiveIsGood ? up : !up;
  return (
    <span className={`text-[11px] font-semibold ${good ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
      {up ? "↑" : "↓"} {Math.abs(value)}
      {suffix}
    </span>
  );
}

function formatDashboardHours(hours: number) {
  return formatHoursMinutes(Math.max(0, hours));
}

function CurrencyIcon({
  currency,
  size = 18,
}: {
  currency: string;
  size?: number;
}) {
  const symbol = currencySymbol(currency).trim() || currency;
  const fontSize = symbol.length > 2 ? size * 0.55 : symbol.length > 1 ? size * 0.78 : size;
  return (
    <span
      className="font-semibold leading-none select-none"
      style={{ fontSize }}
      aria-hidden
    >
      {symbol}
    </span>
  );
}

function AdminCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-200 bg-white p-5 h-full dark:border-[#30363d] dark:bg-[#161b22]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function DonutCard({
  title,
  subtitle,
  centerValue,
  centerLabel,
  rows,
  colors,
  emptyLabel,
  footer,
}: {
  title: string;
  subtitle: string;
  centerValue: number | string;
  centerLabel: string;
  rows: Array<{ name: string; count: number; percent: number; color?: string }>;
  colors: string[];
  emptyLabel: string;
  footer?: ReactNode;
}) {
  return (
    <AdminCard>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-[#1F2937] dark:text-white">{title}</h2>
      </div>
      <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">{subtitle}</p>
      <div className="h-48 relative">
        <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-xl font-bold text-[#1F2937] dark:text-white">{centerValue}</div>
            <div className="text-[10px] text-gray-400 dark:text-slate-500">{centerLabel}</div>
          </div>
        </div>
        <div className="relative z-10 h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rows}
                dataKey="count"
                nameKey="name"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                strokeWidth={0}
              >
                {rows.map((row, i) => (
                  <Cell
                    key={row.name}
                    fill={row.color ?? colors[i % colors.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [`${value}`, name]}
                wrapperStyle={{ zIndex: 30, outline: "none" }}
                contentStyle={{
                  borderRadius: 10,
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
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-4">{emptyLabel}</p>
        ) : (
          rows.map((row, i) => (
            <div
              key={row.name}
              className="flex items-center justify-between text-xs gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: row.color ?? colors[i % colors.length],
                  }}
                />
                <span className="text-gray-600 dark:text-slate-300 truncate">{row.name}</span>
              </div>
              <span className="text-gray-500 dark:text-slate-400 shrink-0">
                {row.count}{" "}
                <span className="text-slate-500">({row.percent}%)</span>
              </span>
            </div>
          ))
        )}
      </div>
      {footer}
    </AdminCard>
  );
}

function AiDailyBrief({
  overdueProjects,
  pendingInvoices,
  hoursLogged,
  hoursDeltaPct,
  onLeave,
  hoursSuffix = "logged this month",
  hoursTrendSuffix = " vs last month",
}: {
  overdueProjects: number;
  pendingInvoices: number;
  hoursLogged: string;
  hoursDeltaPct: number;
  onLeave: number;
  hoursSuffix?: string;
  hoursTrendSuffix?: string;
}) {
  const items = [
    {
      icon: AlertTriangle,
      tone: "text-red-400 bg-red-500/15",
      text: `${overdueProjects} project${overdueProjects === 1 ? " is" : "s are"} overdue`,
    },
    {
      icon: FileText,
      tone: "text-orange-400 bg-orange-500/15",
      text: `${pendingInvoices} invoice${pendingInvoices === 1 ? " is" : "s are"} pending`,
    },
    {
      icon: Clock,
      tone: "text-blue-400 bg-blue-500/15",
      text: `${hoursLogged} ${hoursSuffix}`,
      trend: hoursDeltaPct,
    },
    {
      icon: UserMinus,
      tone: "text-violet-400 bg-violet-500/15",
      text: `${onLeave} team member${onLeave === 1 ? "" : "s"} on leave today`,
    },
  ];

  return (
    <AdminCard className="relative flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-[#1F2937] dark:text-white flex items-center gap-2">
          <Sparkles size={16} className="text-[#2563EB] dark:text-[#60A5FA]" />
          AI Daily Brief
        </h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">Priorities for your workspace today</p>
      <div className="relative min-h-[220px] flex-1">
        <div className="pointer-events-none select-none space-y-2.5 opacity-40 blur-[1px]" aria-hidden>
          {items.map((item) => (
            <div key={item.text} className="flex items-start gap-3">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                  item.tone,
                )}
              >
                <item.icon size={15} />
              </span>
              <div className="min-w-0 pt-1">
                <p className="text-sm text-[#1F2937] dark:text-slate-200">{item.text}</p>
                {typeof item.trend === "number" && item.trend !== 0 ? (
                  <TrendText value={item.trend} suffix={`%${hoursTrendSuffix}`} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <form className="pointer-events-none mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 opacity-40 blur-[1px] dark:border-[#1C2330] dark:bg-[#0B0E14]" aria-hidden onSubmit={(e) => e.preventDefault()}>
          <input readOnly tabIndex={-1} placeholder="Ask AI Anything" className="flex-1 bg-transparent text-sm text-[#1F2937] dark:text-white placeholder:text-slate-500 outline-none"/>
          <span className="text-xs font-semibold text-[#2563EB] dark:text-[#60A5FA] inline-flex items-center gap-1 shrink-0">
            Ask
            <ArrowRight size={12} />
          </span>
        </form>
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/35 backdrop-blur-md backdrop-saturate-150 ring-1 ring-inset ring-white/50 dark:bg-[#161b22]/45 dark:ring-white/10">
          <span className="rounded-full border border-white/60 bg-white/50 px-4 py-1.5 text-sm font-semibold tracking-wide text-slate-700 shadow-[0_8px_30px_rgb(15_23_42_/_0.08)] backdrop-blur-md dark:border-white/15 dark:bg-white/10 dark:text-slate-100">
            Coming soon
          </span>
        </div>
      </div>
    </AdminCard>
  );
}

export function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const firstName = user?.name?.split(" ")[0] || "there";
  const greeting = useMemo(() => istTimeOfDayGreeting(new Date()), []);

  const initialRange = useMemo(() => resolvePresetRange("this_month"), []);
  const [preset, setPreset] = useState<DatePresetId>("this_month");
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [dateOpen, setDateOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [sections, setSections] = useState<Record<DashboardSectionId, boolean>>(loadSectionVisibility);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(() => ({
    from: keyToLocalDate(initialRange.startDate),
    to: keyToLocalDate(initialRange.endDate),
  }));

  const { data, isLoading, isFetching } = trpc.dashboard.getHrDashboard.useQuery(
    { startDate, endDate },
    dashboardQueryOptions,
  );

  useEffect(() => {
    const onRefresh = () => {
      void refreshDashboardPage(utils);
    };
    window.addEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
  }, [utils]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOMIZE_STORAGE_KEY, JSON.stringify(sections));
    } catch {
      // ignore quota / private mode
    }
  }, [sections]);

  const planAllowsSection = (id: DashboardSectionId) => {
    if (id === "projectOverview") return hasPlanFeature(user, "projects");
    if (id === "myTasks") return hasPlanFeature(user, "tasks");
    if (id === "workforceKpis" || id === "workOverview" || id === "recentJoiners") {
      return hasPlanFeature(user, "employees");
    }
    if (id === "monthMetrics") {
      return (
        hasPlanFeature(user, "time_tracking") ||
        hasPlanFeature(user, "finance") ||
        hasPlanFeature(user, "invoices")
      );
    }
    if (id === "aiBrief") {
      return (
        hasPlanFeature(user, "projects") ||
        hasPlanFeature(user, "invoices") ||
        hasPlanFeature(user, "time_tracking") ||
        hasPlanFeature(user, "leave")
      );
    }
    return true;
  };

  const show = (id: DashboardSectionId) => planAllowsSection(id) && sections[id] !== false;

  function applyPreset(next: DatePresetId) {
    if (next === "custom") {
      setPreset("custom");
      return;
    }
    const range = resolvePresetRange(next);
    setPreset(next);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setDraftRange({
      from: keyToLocalDate(range.startDate),
      to: keyToLocalDate(range.endDate),
    });
    setDateOpen(false);
  }

  function applyCustomRange(range: DateRange | undefined) {
    setDraftRange(range);
    setPreset("custom");
  }

  function commitDraftRange(range = draftRange) {
    if (!range?.from) return;
    const fromKey = workZoneDateKey(range.from);
    const toKey = workZoneDateKey(range.to ?? range.from);
    const start = fromKey <= toKey ? fromKey : toKey;
    const end = fromKey <= toKey ? toKey : fromKey;
    setPreset("custom");
    setStartDate(start);
    setEndDate(end);
  }

  function toggleSection(id: DashboardSectionId) {
    setSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const dateLabel =
    preset === "custom"
      ? formatRangeLabel(startDate, endDate)
      : preset === "this_month"
        ? "This Month"
        : preset === "today"
          ? "Today"
          : preset === "last_30"
            ? "Last 30 days"
            : preset === "this_quarter"
              ? "This quarter"
              : preset === "this_year"
                ? "This year"
                : formatRangeLabel(startDate, endDate);
  const periodCompareLabel = preset === "this_month" ? " vs last month" : " vs prior period";
  const hoursLoggedLabel = preset === "this_month" ? "logged this month" : "logged in this period";

  const metrics = data?.monthMetrics;
  const projectOverview = data?.projectOverview;
  const workRows = data?.byDepartment ?? [];
  const currency = metrics?.currency || "INR";

  const projectRows = useMemo(
    () =>
      (projectOverview?.byStatus ?? []).map((row) => ({
        ...row,
        color: projectStatusColor(row.name),
      })),
    [projectOverview?.byStatus],
  );

  const overdueProjects =
    projectRows.find((row) => row.name.toLowerCase().includes("overdue"))?.count ?? 0;

  const metricCards = useMemo(() => {
    if (!metrics) return [];
    return [
      {
        title: "Total Hours Logged",
        value: formatDashboardHours(metrics.totalHoursLogged),
        sub: "Attendance hours",
        trend: (
          <TrendText value={metrics.totalHoursDeltaPct} suffix={`%${periodCompareLabel}`} />
        ),
        icon: Clock,
        iconWrap: "bg-blue-50 text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]",
      },
      {
        title: "Billable Hours",
        value: formatDashboardHours(metrics.billableHours),
        sub: `${metrics.billablePct}% of total`,
        trend: null,
        icon: Briefcase,
        iconWrap: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
      },
      {
        title: "Team Utilization",
        value: `${metrics.teamUtilizationPct}%`,
        sub: null,
        trend: (
          <TrendText value={metrics.utilizationDeltaPct} suffix={`%${periodCompareLabel}`} />
        ),
        icon: TrendingUp,
        iconWrap: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
      },
      {
        title: "Pending Invoices",
        value: formatMoney(metrics.pendingInvoicesAmount, currency),
        sub: `${metrics.pendingInvoicesCount} invoice${
          metrics.pendingInvoicesCount === 1 ? "" : "s"
        }`,
        trend: null,
        icon: FileText,
        iconWrap: "bg-orange-50 text-orange-500 dark:bg-orange-500/15 dark:text-orange-400",
      },
      {
        title: preset === "this_month" ? "Revenue This Month" : "Revenue",
        value: formatMoney(metrics.revenueThisMonth, currency),
        sub: preset === "this_month" ? null : formatRangeLabel(startDate, endDate),
        trend: (
          <TrendText value={metrics.revenueDeltaPct} suffix={`%${periodCompareLabel}`} />
        ),
        icon: (props: { size?: number }) => (
          <CurrencyIcon currency={currency} size={props.size} />
        ),
        iconWrap: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
      },
    ];
  }, [metrics, currency, periodCompareLabel, preset, startDate, endDate]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.35, ease: "easeOut" as const },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-[#1F2937] dark:text-white">
            {greeting}, {firstName}{" "}
            <span
              className="inline-block origin-[70%_70%] animate-wave"
              role="img"
              aria-label="waving hand"
            >
              👋
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {formatWorkZoneDate(new Date(), {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {isFetching ? (
              <span className="ml-2 inline-flex items-center gap-1 text-slate-400">
                Updating…
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Popover
            modal={false}
            open={dateOpen}
            onOpenChange={(open) => {
              if (!open && preset === "custom") {
                commitDraftRange();
              }
              setDateOpen(open);
              if (open) {
                setDraftRange({
                  from: keyToLocalDate(startDate),
                  to: keyToLocalDate(endDate),
                });
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-9 px-3 rounded-xl border border-gray-200 bg-white text-sm text-slate-600 inline-flex items-center gap-2 hover:bg-gray-50 dark:border-[#30363d] dark:bg-[#161b22] dark:text-slate-300 dark:hover:bg-white/5"
              >
                <CalendarRange size={15} className="text-slate-400" />
                <span className="max-w-[220px] truncate">{dateLabel}</span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-3 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["today", "Today"],
                    ["last_30", "Last 30 days"],
                    ["this_month", "This month"],
                    ["this_quarter", "This quarter"],
                    ["this_year", "This year"],
                    ["custom", "Custom"],
                  ] as Array<[DatePresetId, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => applyPreset(id)}
                    className={cn(
                      "h-7 px-2.5 rounded-md text-xs font-medium border",
                      preset === id
                        ? "bg-[#2563EB] text-white border-[#2563EB]"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:bg-[#161b22] dark:text-slate-300 dark:border-[#30363d]",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Calendar
                mode="range"
                numberOfMonths={1}
                captionLayout="dropdown"
                selected={draftRange}
                onSelect={applyCustomRange}
                defaultMonth={draftRange?.from ?? keyToLocalDate(startDate)}
                disabled={{ after: new Date() }}
                startMonth={new Date(2020, 0)}
                endMonth={new Date()}
              />
              {preset === "custom" && draftRange?.from ? (
                <p className="text-center text-xs text-slate-500">
                  {formatRangeLabel(
                    workZoneDateKey(draftRange.from),
                    workZoneDateKey(draftRange.to ?? draftRange.from),
                  )}
                  {!draftRange.to ? " · pick an end date" : ""}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => applyPreset("this_month")}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-[#2563EB] hover:bg-[#1D4ED8]"
                  onClick={() => {
                    if (preset === "custom") commitDraftRange();
                    setDateOpen(false);
                  }}
                >
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Popover modal={false} open={customizeOpen} onOpenChange={setCustomizeOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-9 px-3 rounded-xl border border-gray-200 bg-white text-sm text-slate-600 inline-flex items-center gap-1.5 hover:bg-gray-50 dark:border-[#30363d] dark:bg-[#161b22] dark:text-slate-300 dark:hover:bg-white/5"
              >
                <Paintbrush size={14} />
                Customize
                <ChevronDown size={14} className="text-slate-400" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3 space-y-3">
              <div>
                <div className="text-sm font-semibold text-[#1F2937] dark:text-white">
                  Customize dashboard
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Choose which sections appear on your home.
                </p>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {SECTION_LABELS.filter((section) => planAllowsSection(section.id)).map((section) => (
                  <label
                    key={section.id}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-50 cursor-pointer dark:hover:bg-white/5"
                  >
                    <Checkbox
                      checked={show(section.id)}
                      onCheckedChange={() => toggleSection(section.id)}
                    />
                    <span className="text-sm text-gray-700 dark:text-slate-200">{section.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-between gap-2 pt-1 border-t border-gray-100 dark:border-[#30363d]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setSections({ ...DEFAULT_SECTIONS })}
                >
                  Show all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-[#2563EB] hover:bg-[#1D4ED8]"
                  onClick={() => setCustomizeOpen(false)}
                >
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </motion.div>

      {isLoading && !data ? (
        <div className="h-40 rounded-2xl border border-gray-200 bg-white animate-pulse dark:border-[#30363d] dark:bg-[#161b22]" />
      ) : (
        <>
          {show("workforceKpis") ? (
            <motion.div variants={itemVariants}>
              <WorkforceKpiCards
                data={data}
                joinersSub={preset === "this_month" ? "This month" : "In selected period"}
                joinersTrendSuffix={periodCompareLabel}
              />
            </motion.div>
          ) : null}

          {show("workOverview") || show("projectOverview") || show("aiBrief") ? (
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch"
          >
            {show("workOverview") ? (
            <DonutCard
              title="Work Overview"
              subtitle="Team by department / role"
              centerValue={
                data?.overviewStaffTotal ??
                workRows.reduce((sum, row) => sum + row.count, 0)
              }
              centerLabel="Total"
              rows={workRows}
              colors={WORK_COLORS}
              emptyLabel="No work overview data yet"
              footer={
                <button
                  type="button"
                  onClick={() => navigate("/admin/departments")}
                  className="mt-4 w-full h-9 rounded-lg border border-gray-200 text-sm font-medium text-[#2563EB] hover:bg-blue-50 transition-colors inline-flex items-center justify-center gap-1.5 dark:border-[#1C2330] dark:text-[#60A5FA] dark:hover:bg-white/5"
                >
                  View Full Report
                  <ArrowRight size={14} />
                </button>
              }
            />
            ) : null}
            {show("projectOverview") ? (
            <DonutCard
              title="Project Overview"
              subtitle="By status"
              centerValue={projectOverview?.total ?? 0}
              centerLabel="Total Projects"
              rows={projectRows}
              colors={WORK_COLORS}
              emptyLabel="No projects yet"
              footer={
                <button
                  type="button"
                  onClick={() => navigate("/projects")}
                  className="mt-4 w-full h-9 rounded-lg border border-gray-200 text-sm font-medium text-[#2563EB] hover:bg-blue-50 transition-colors inline-flex items-center justify-center gap-1.5 dark:border-[#1C2330] dark:text-[#60A5FA] dark:hover:bg-white/5"
                >
                  View All Projects
                  <ArrowRight size={14} />
                </button>
              }
            />
            ) : null}
            {show("aiBrief") ? (
            <AiDailyBrief
              overdueProjects={overdueProjects}
              pendingInvoices={metrics?.pendingInvoicesCount ?? 0}
              hoursLogged={formatDashboardHours(metrics?.totalHoursLogged ?? 0)}
              hoursDeltaPct={metrics?.totalHoursDeltaPct ?? 0}
              onLeave={data?.onLeaveToday ?? 0}
              hoursSuffix={hoursLoggedLabel}
              hoursTrendSuffix={periodCompareLabel}
            />
            ) : null}
          </motion.div>
          ) : null}

          {show("monthMetrics") && metricCards.length > 0 ? (
            <motion.div
              variants={itemVariants}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4"
            >
              {metricCards.map((card) => (
                <div
                  key={card.title}
                  className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-[#1C2330] dark:bg-[#12161E]"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-500 dark:text-slate-400">{card.title}</div>
                      <div className="text-xl font-bold text-[#1F2937] dark:text-white mt-1 truncate">
                        {card.value}
                      </div>
                      {card.sub ? (
                        <div className="text-[11px] text-slate-500 mt-0.5">{card.sub}</div>
                      ) : null}
                    </div>
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${card.iconWrap}`}
                    >
                      <card.icon size={18} />
                    </div>
                  </div>
                  {card.trend}
                </div>
              ))}
            </motion.div>
          ) : null}

          {show("recentJoiners") || show("birthdays") || show("myTasks") || show("calendar") ? (
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch min-w-0 [&>*]:min-w-0"
          >
            {show("recentJoiners") ? (
            <AdminCard>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[#1F2937] dark:text-white">Recent Joiners</h2>
              </div>
              <div className="space-y-3">
                {(data?.recentJoiners ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No recent joiners</p>
                ) : (
                  (data?.recentJoiners ?? []).map((person) => (
                    <div key={person.id} className="flex items-center gap-3">
                      <UserAvatar
                        name={person.name}
                        avatar={person.avatar}
                        size={40}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[#1F2937] dark:text-white truncate">
                          {person.name}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {person.position}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 shrink-0">
                        Joined {person.joinedLabel}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </AdminCard>
            ) : null}

            {show("birthdays") ? (
            <UpcomingBirthdaysPanel
              birthdays={data?.upcomingBirthdays ?? []}
            />
            ) : null}

            {show("myTasks") ? <AdminDashboardMyTasks /> : null}

            {show("calendar") ? <DashboardCalendarEventsBlocks stacked /> : null}
          </motion.div>
          ) : null}
        </>
      )}
    </motion.div>
  );
}
