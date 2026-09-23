import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  formatWorkZoneDate,
  istTimeOfDayGreeting,
  workZoneDateKey,
  workZoneDateParts,
} from "@/lib/timezone";
import {
  dashboardQueryOptions,
  DASHBOARD_REFRESH_EVENT,
  refreshDashboardPage,
} from "@/lib/dashboard-refresh";
import { formatMoney } from "@/lib/invoice-store";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import {
  Loader2,
  CircleDollarSign,
  Wallet,
  TrendingUp,
  TrendingDown,
  Landmark,
  Receipt,
  FileText,
  Banknote,
  ClipboardList,
  ScrollText,
  CheckCircle2,
  Settings2,
  CalendarRange,
  ChevronDown,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  ReferenceLine,
  Area,
  ComposedChart,
  Line,
} from "recharts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CUSTOMIZE_STORAGE_KEY = "finance-dashboard-layout-v1";

type DashboardSectionId =
  | "kpis"
  | "revenueOverview"
  | "incomeVsExpense"
  | "cashFlow"
  | "outstanding"
  | "recentTransactions"
  | "expenseBreakdown"
  | "aging"
  | "upcoming"
  | "banks"
  | "quickActions";

const DEFAULT_SECTIONS: Record<DashboardSectionId, boolean> = {
  kpis: true,
  revenueOverview: true,
  incomeVsExpense: true,
  cashFlow: true,
  outstanding: true,
  recentTransactions: true,
  expenseBreakdown: true,
  aging: true,
  upcoming: true,
  banks: true,
  quickActions: true,
};

const SECTION_LABELS: Array<{ id: DashboardSectionId; label: string }> = [
  { id: "kpis", label: "KPI cards" },
  { id: "revenueOverview", label: "Revenue overview" },
  { id: "incomeVsExpense", label: "Income vs expense" },
  { id: "cashFlow", label: "Cash flow" },
  { id: "outstanding", label: "Outstanding invoices" },
  { id: "recentTransactions", label: "Recent transactions" },
  { id: "expenseBreakdown", label: "Expense breakdown" },
  { id: "aging", label: "Receivable aging" },
  { id: "upcoming", label: "Upcoming invoices" },
  { id: "banks", label: "Bank accounts" },
  { id: "quickActions", label: "Quick actions" },
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
    case "this_month":
      return { startDate: startOfMonthKey(), endDate: today };
    case "this_quarter":
      return { startDate: startOfQuarterKey(), endDate: today };
    case "last_30":
      return { startDate: shiftDaysKey(today, -29), endDate: today };
    case "this_year":
    default:
      return { startDate: startOfYearKey(), endDate: today };
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

function TrendChip({
  value,
  suffix,
  positiveIsGood = true,
}: {
  value: number;
  suffix: string;
  positiveIsGood?: boolean;
}) {
  if (value === 0) {
    return <span className="text-[11px] font-medium text-gray-400">No change {suffix}</span>;
  }
  const up = value > 0;
  const good = positiveIsGood ? up : !up;
  return (
    <span className={`text-[11px] font-semibold inline-flex items-center gap-0.5 ${good ? "text-emerald-600" : "text-red-500"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(value)}%{suffix}
    </span>
  );
}

function StatusPill({
  tone,
  label,
}: {
  tone: "received" | "paid" | "sent" | "draft";
  label: string;
}) {
  const styles = {
    received: "bg-emerald-50 text-emerald-700",
    paid: "bg-blue-50 text-blue-700",
    sent: "bg-amber-50 text-amber-700",
    draft: "bg-gray-100 text-gray-600",
  }[tone];
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${styles}`}>
      {label}
    </span>
  );
}

function KpiCard({
  title,
  value,
  trend,
  icon: Icon,
  iconWrap,
}: {
  title: string;
  value: string;
  trend: ReactNode;
  icon: typeof CircleDollarSign;
  iconWrap: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm min-w-0">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconWrap}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className="text-xs text-gray-500 font-medium">{title}</div>
      <div className="text-lg font-bold text-[#1F2937] mt-0.5 truncate">{value}</div>
      <div className="mt-1">{trend}</div>
    </div>
  );
}

export function FinanceDashboard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const greeting = useMemo(() => istTimeOfDayGreeting(new Date()), []);
  const firstName = user?.name?.split(" ")[0] || "there";

  const initialRange = useMemo(() => resolvePresetRange("this_year"), []);
  const [preset, setPreset] = useState<DatePresetId>("this_year");
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [dateOpen, setDateOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [sections, setSections] = useState<Record<DashboardSectionId, boolean>>(loadSectionVisibility);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(() => ({
    from: keyToLocalDate(initialRange.startDate),
    to: keyToLocalDate(initialRange.endDate),
  }));

  const { data, isLoading, isFetching } = trpc.dashboard.getFinanceDashboard.useQuery(
    { startDate, endDate },
    dashboardQueryOptions,
  );

  useEffect(() => {
    const onRefresh = () => {
      void refreshDashboardPage(utils);
      void utils.dashboard.getFinanceDashboard.invalidate();
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

  const currency = data?.currency || "INR";
  const money = (n: number) => formatMoney(n, currency);
  const show = (id: DashboardSectionId) => sections[id] !== false;

  const incomeExpensePie = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Income", value: data.incomeVsExpense.income, color: "#059669" },
      { name: "Expense", value: data.incomeVsExpense.expense, color: "#F97316" },
    ];
  }, [data]);

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

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[#2563EB]" />
      </div>
    );
  }

  if (!data) return null;

  const dateLabel = formatRangeLabel(startDate, endDate);
  const periodSuffix = " vs prior period";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-5 pb-4"
    >
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold text-[#1F2937]">
            {greeting}, {firstName}{" "}
            <span className="inline-block origin-[70%_70%] animate-wave" role="img" aria-label="waving hand">
              👋
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Here&apos;s your accounts overview for the selected period.
            {isFetching ? (
              <span className="ml-2 inline-flex items-center gap-1 text-gray-400">
                <Loader2 size={12} className="animate-spin" />
                Updating…
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover
            open={dateOpen}
            onOpenChange={(open) => {
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
                className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 inline-flex items-center gap-2 shadow-sm hover:bg-gray-50"
              >
                <CalendarRange size={15} className="text-gray-400" />
                <span className="max-w-[220px] truncate">{dateLabel}</span>
                <ChevronDown size={14} className="text-gray-400" />
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
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Calendar
                mode="range"
                numberOfMonths={1}
                selected={draftRange}
                onSelect={applyCustomRange}
                defaultMonth={draftRange?.from ?? keyToLocalDate(startDate)}
                disabled={{ after: new Date() }}
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => applyPreset("this_year")}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-[#2563EB] hover:bg-[#1D4ED8]"
                  onClick={() => setDateOpen(false)}
                >
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={customizeOpen} onOpenChange={setCustomizeOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 inline-flex items-center gap-2 shadow-sm hover:bg-gray-50"
              >
                <Settings2 size={15} className="text-gray-400" />
                Customize
                <ChevronDown size={14} className="text-gray-400" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3 space-y-3">
              <div>
                <div className="text-sm font-semibold text-[#1F2937]">Customize dashboard</div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Choose which sections appear on your finance home.
                </p>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {SECTION_LABELS.map((section) => (
                  <label
                    key={section.id}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <Checkbox
                      checked={show(section.id)}
                      onCheckedChange={() => toggleSection(section.id)}
                    />
                    <span className="text-sm text-gray-700">{section.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-between gap-2 pt-1 border-t border-gray-100">
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
      </div>

      {show("kpis") ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard
            title="Total Revenue"
            value={money(data.totalRevenueYtd)}
            trend={<TrendChip value={data.revenueYoYPct} suffix={periodSuffix} />}
            icon={CircleDollarSign}
            iconWrap="bg-blue-50 text-[#2563EB]"
          />
          <KpiCard
            title="Total Received"
            value={money(data.totalReceivedYtd)}
            trend={<TrendChip value={data.receivedYoYPct} suffix={periodSuffix} />}
            icon={Banknote}
            iconWrap="bg-emerald-50 text-emerald-600"
          />
          <KpiCard
            title="Outstanding Receivable"
            value={money(data.outstandingReceivable)}
            trend={<TrendChip value={data.outstandingMoMPct} suffix=" vs last month" positiveIsGood={false} />}
            icon={Wallet}
            iconWrap="bg-amber-50 text-amber-600"
          />
          <KpiCard
            title="Total Expenses"
            value={money(data.totalExpensesYtd)}
            trend={<TrendChip value={data.expensesYoYPct} suffix={periodSuffix} positiveIsGood={false} />}
            icon={Receipt}
            iconWrap="bg-orange-50 text-orange-600"
          />
          <KpiCard
            title="Net Profit"
            value={money(data.netProfitYtd)}
            trend={<TrendChip value={data.netProfitYoYPct} suffix={periodSuffix} />}
            icon={TrendingUp}
            iconWrap="bg-violet-50 text-violet-600"
          />
          <KpiCard
            title="Cash in Bank"
            value={money(data.cashInBank)}
            trend={<span className="text-[11px] font-medium text-gray-400">As on today</span>}
            icon={Landmark}
            iconWrap="bg-sky-50 text-sky-600"
          />
        </div>
      ) : null}

      {(show("revenueOverview") || show("incomeVsExpense") || show("cashFlow")) ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {show("revenueOverview") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 xl:col-span-1 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-[#1F2937]">Revenue Overview</h2>
              </div>
              <p className="text-xs text-gray-400 mb-3">This year vs last year</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.revenueOverview}>
                    <defs>
                      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="#9CA3AF"
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        money(value),
                        name === "thisYear" ? "This Year" : "Last Year",
                      ]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
                    />
                    <Area type="monotone" dataKey="thisYear" stroke="none" fill="url(#revFill)" />
                    <Line type="monotone" dataKey="thisYear" stroke="#2563EB" strokeWidth={2.5} dot={false} />
                    <Line
                      type="monotone"
                      dataKey="lastYear"
                      stroke="#93C5FD"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#2563EB] rounded" /> This Year
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#93C5FD] rounded border-dashed" /> Last Year
                </span>
              </div>
            </div>
          ) : null}

          {show("incomeVsExpense") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h2 className="font-semibold text-[#1F2937]">Income vs Expense</h2>
              <p className="text-xs text-gray-400 mb-2">Selected period</p>
              <div className="h-48 relative">
                <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-sm font-bold text-[#1F2937]">{money(data.incomeVsExpense.income)}</div>
                    <div className="text-[10px] text-gray-400">Income</div>
                  </div>
                </div>
                <div className="relative z-10 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={incomeExpensePie}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={52}
                        outerRadius={74}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {incomeExpensePie.map((row) => (
                          <Cell key={row.name} fill={row.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [money(value), name]}
                        wrapperStyle={{ zIndex: 30, outline: "none" }}
                        contentStyle={{
                          borderRadius: 8,
                          border: "1px solid #E5E7EB",
                          backgroundColor: "#ffffff",
                          fontSize: 12,
                          opacity: 1,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="space-y-1.5 mt-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-emerald-700 font-medium">Income</span>
                  <span>
                    {money(data.incomeVsExpense.income)} · {data.incomeVsExpense.incomePct}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-orange-600 font-medium">Expense</span>
                  <span>
                    {money(data.incomeVsExpense.expense)} · {data.incomeVsExpense.expensePct}%
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {show("cashFlow") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-[#1F2937]">Cash Flow</h2>
                <span className="text-xs text-gray-400">This Month</span>
              </div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.cashFlow.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={4} stroke="#9CA3AF" />
                    <YAxis hide />
                    <ReferenceLine y={0} stroke="#D1D5DB" />
                    <Tooltip
                      formatter={(value: number) => [money(value), "Net"]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
                    />
                    <Bar dataKey="net" radius={[3, 3, 0, 0]}>
                      {data.cashFlow.daily.map((entry, index) => (
                        <Cell key={index} fill={entry.net >= 0 ? "#10B981" : "#EF4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="rounded-lg bg-gray-50 p-2">
                  <div className="text-[10px] text-gray-400">Net</div>
                  <div className="text-xs font-bold text-[#1F2937]">{money(data.cashFlow.net)}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 p-2">
                  <div className="text-[10px] text-emerald-700/70">Inflows</div>
                  <div className="text-xs font-bold text-emerald-700">{money(data.cashFlow.inflows)}</div>
                </div>
                <div className="rounded-lg bg-red-50 p-2">
                  <div className="text-[10px] text-red-600/70">Outflows</div>
                  <div className="text-xs font-bold text-red-600">{money(data.cashFlow.outflows)}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {(show("outstanding") || show("recentTransactions") || show("expenseBreakdown")) ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {show("outstanding") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 xl:col-span-1 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-[#1F2937]">Outstanding Invoices</h2>
                <Link to="/admin/invoices" className="text-xs text-[#2563EB] hover:underline">
                  View all
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {[
                  { label: "Total", value: data.outstandingSummary.total },
                  { label: "0-30 Days", value: data.outstandingSummary.d0_30 },
                  { label: "31-60 Days", value: data.outstandingSummary.d31_60 },
                  { label: "61+ Days", value: data.outstandingSummary.d61_plus },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg bg-gray-50 px-2 py-2">
                    <div className="text-[10px] text-gray-400">{item.label}</div>
                    <div className="text-xs font-bold text-[#1F2937] truncate">{money(item.value)}</div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="pb-2 font-medium">Invoice #</th>
                      <th className="pb-2 font-medium">Client</th>
                      <th className="pb-2 font-medium">Due</th>
                      <th className="pb-2 font-medium text-right">Amount</th>
                      <th className="pb-2 font-medium text-right">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.outstandingInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-gray-400">
                          No outstanding invoices
                        </td>
                      </tr>
                    ) : (
                      data.outstandingInvoices.map((inv) => (
                        <tr key={inv.id} className="border-b border-gray-50 last:border-0">
                          <td className="py-2.5">
                            <Link to={`/admin/invoices/${inv.id}`} className="font-medium text-[#2563EB] hover:underline">
                              {inv.invoiceNumber}
                            </Link>
                          </td>
                          <td className="py-2.5 text-gray-600 truncate max-w-[7rem]">{inv.customerName}</td>
                          <td className="py-2.5 text-gray-500 whitespace-nowrap">{inv.dueDate}</td>
                          <td className="py-2.5 text-right font-medium">{money(inv.amount)}</td>
                          <td className={`py-2.5 text-right font-semibold ${inv.daysOverdue > 0 ? "text-red-500" : "text-gray-400"}`}>
                            {inv.daysOverdue > 0 ? `${inv.daysOverdue}d` : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {show("recentTransactions") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h2 className="font-semibold text-[#1F2937] mb-3">Recent Transactions</h2>
              <div className="space-y-2.5 max-h-[320px] overflow-y-auto">
                {data.recentTransactions.length === 0 ? (
                  <p className="text-sm text-gray-400 py-6 text-center">No recent activity</p>
                ) : (
                  data.recentTransactions.map((tx) => {
                    const row = (
                      <div className="flex items-start justify-between gap-2 rounded-lg hover:bg-gray-50 px-1 py-1.5">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-gray-800 truncate">{tx.type}</div>
                          <div className="text-[11px] text-gray-400 truncate">{tx.description}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{tx.date}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-xs font-semibold ${tx.amount < 0 ? "text-red-500" : "text-gray-800"}`}>
                            {money(tx.amount)}
                          </div>
                          <div className="mt-1">
                            <StatusPill tone={tx.statusTone} label={tx.status} />
                          </div>
                        </div>
                      </div>
                    );
                    return tx.href ? (
                      <Link key={tx.id} to={tx.href} className="block">
                        {row}
                      </Link>
                    ) : (
                      <div key={tx.id}>{row}</div>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          {show("expenseBreakdown") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h2 className="font-semibold text-[#1F2937]">Expense Breakdown</h2>
              <p className="text-xs text-gray-400 mb-2">Selected period</p>
              <div className="h-44 relative">
                {data.expenseBreakdown.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400">
                    No recorded expenses in this period
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.expenseBreakdown}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={70}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {data.expenseBreakdown.map((row) => (
                        <Cell key={row.name} fill={row.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [money(value), name]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                )}
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {data.expenseBreakdown.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-2">
                    Add expenses to see the category split
                  </p>
                ) : (
                data.expenseBreakdown.map((row) => (
                  <div key={row.name} className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                      <span className="text-gray-600 truncate">{row.name}</span>
                    </div>
                    <span className="text-gray-800 font-medium shrink-0">
                      {money(row.amount)} · {row.percent}%
                    </span>
                  </div>
                ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {(show("aging") || show("upcoming") || show("banks") || show("quickActions")) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {show("aging") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h2 className="font-semibold text-[#1F2937] mb-3">Accounts Receivable Aging</h2>
              <div className="space-y-2.5">
                {data.receivableAging.map((row) => (
                  <div key={row.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-500">{row.label}</span>
                      <span className="font-semibold text-gray-800">
                        {money(row.amount)} · {row.percent}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#2563EB]"
                        style={{ width: `${Math.min(100, row.percent)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {show("upcoming") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-[#1F2937]">Upcoming Invoices</h2>
                <Link to="/admin/invoices" className="text-xs text-[#2563EB] hover:underline">
                  View all
                </Link>
              </div>
              <div className="space-y-3">
                {data.upcomingInvoices.length === 0 ? (
                  <p className="text-sm text-gray-400">No upcoming due invoices</p>
                ) : (
                  data.upcomingInvoices.map((inv) => (
                    <Link
                      key={inv.id}
                      to={`/admin/invoices/${inv.id}`}
                      className="flex items-center justify-between gap-2 hover:bg-gray-50 rounded-lg -mx-1 px-1 py-0.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{inv.invoiceNumber}</div>
                        <div className="text-[11px] text-gray-400 truncate">
                          {inv.customerName} · Due {inv.dueDate}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-gray-800 shrink-0">{money(inv.amount)}</div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {show("banks") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-[#1F2937]">Bank Accounts</h2>
                <Link to="/finance/banks" className="text-xs text-[#2563EB] hover:underline">
                  Manage
                </Link>
              </div>
              <div className="space-y-3">
                {data.bankAccounts.map((bank, index) => (
                  <div
                    key={`${bank.name}-${bank.mask}-${index}`}
                    className="rounded-xl border border-gray-100 bg-gray-50/80 p-3"
                  >
                    <div className="text-sm font-medium text-gray-800">{bank.name}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{bank.mask}</div>
                    <div className="text-base font-bold text-[#1F2937] mt-2">{money(bank.balance)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {show("quickActions") ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h2 className="font-semibold text-[#1F2937] mb-3">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Create Invoice", to: "/admin/invoices/new", icon: FileText },
                  { label: "Record Payment", to: "/finance/payments", icon: Banknote },
                  { label: "Add Expense", to: "/finance/expenses", icon: Receipt },
                  { label: "Create Estimate", to: "/finance/estimates", icon: ClipboardList },
                  { label: "New Contract", to: "/finance/contracts", icon: ScrollText },
                  { label: "Bank Reconciliation", to: "/finance/banks", icon: Landmark },
                ].map((action) => (
                  <Link
                    key={action.label}
                    to={action.to}
                    className="rounded-xl border border-gray-200 bg-white hover:bg-blue-50/50 hover:border-blue-200 p-3 text-center transition-colors"
                  >
                    <action.icon size={18} className="mx-auto text-[#2563EB]" />
                    <div className="text-[11px] font-semibold text-gray-700 mt-1.5 leading-tight">
                      {action.label}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-center gap-2 text-xs text-gray-400 pt-1 pb-2">
        <CheckCircle2 size={14} className="text-emerald-500" />
        All financial data is synchronized and up to date.
      </div>
    </motion.div>
  );
}
