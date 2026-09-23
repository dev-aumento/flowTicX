import { useMemo, type ReactNode } from "react";
import {
  Users,
  UserCheck,
  UserX,
  UserPlus,
  Building2,
} from "lucide-react";

function TrendChip({
  value,
  suffix,
  positiveIsGood = true,
  dark = false,
}: {
  value: number;
  suffix: string;
  positiveIsGood?: boolean;
  dark?: boolean;
}) {
  if (value === 0) {
    return (
      <span className="text-[11px] font-medium text-gray-400 dark:text-slate-500">
        No change {suffix}
      </span>
    );
  }
  const up = value > 0;
  const good = positiveIsGood ? up : !up;
  return (
    <span
      className={`text-[11px] font-semibold ${
        good ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
      }`}
    >
      {up ? "↑" : "↓"} {Math.abs(value)}
      {suffix}
    </span>
  );
}

type WorkforceKpiData = {
  totalEmployees: number;
  presentToday: number;
  presentPct: number;
  presentDeltaPct: number;
  onLeaveToday: number;
  onLeavePct: number;
  onLeaveDeltaPct: number;
  newJoinersThisMonth: number;
  joinersDelta: number;
  departmentsCount: number;
};

export function WorkforceKpiCards({
  data,
  className = "",
  variant = "light",
  joinersSub = "This month",
  joinersTrendSuffix = " vs last month",
}: {
  data: WorkforceKpiData | null | undefined;
  className?: string;
  variant?: "light" | "dark";
  joinersSub?: string;
  joinersTrendSuffix?: string;
}) {
  const dark = variant === "dark";
  const kpiCards = useMemo(() => {
    if (!data) return [];
    return [
      {
        title: "Total Employees",
        value: data.totalEmployees,
        sub: "Active employees",
        icon: Users,
        iconWrap: "bg-blue-50 text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]",
        trend: null as ReactNode,
      },
      {
        title: "Present Today",
        value: data.presentToday,
        sub: `${data.presentPct}% of total`,
        icon: UserCheck,
        iconWrap: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
        trend: (
          <TrendChip
            value={data.presentDeltaPct}
            suffix="% vs yesterday"
            positiveIsGood
            dark={dark}
          />
        ),
      },
      {
        title: "On Leave",
        value: data.onLeaveToday,
        sub: `${data.onLeavePct}% of total`,
        icon: UserX,
        iconWrap: "bg-orange-50 text-orange-500 dark:bg-orange-500/15 dark:text-orange-400",
        trend: (
          <TrendChip
            value={data.onLeaveDeltaPct}
            suffix="% vs yesterday"
            positiveIsGood={false}
            dark={dark}
          />
        ),
      },
      {
        title: "New Joiners",
        value: data.newJoinersThisMonth,
        sub: joinersSub,
        icon: UserPlus,
        iconWrap: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
        trend: (
          <TrendChip
            value={data.joinersDelta}
            suffix={joinersTrendSuffix}
            positiveIsGood
            dark={dark}
          />
        ),
      },
      {
        title: "Departments",
        value: data.departmentsCount,
        sub: "Active departments",
        icon: Building2,
        iconWrap: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
        trend: null,
      },
    ];
  }, [data, dark, joinersSub, joinersTrendSuffix]);

  if (kpiCards.length === 0) return null;

  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 ${className}`.trim()}
    >
      {kpiCards.map((card) => (
        <div
          key={card.title}
          className={
            dark
              ? "rounded-2xl border border-[#1C2330] bg-[#12161E] p-4"
              : "bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow dark:rounded-2xl dark:border-[#30363d] dark:bg-[#161b22] dark:hover:shadow-none"
          }
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-slate-400">
                {card.title}
              </div>
              <div className="text-2xl font-bold mt-1 text-[#1F2937] dark:text-white">
                {card.value}
              </div>
              <div className="text-[11px] mt-0.5 text-gray-400 dark:text-slate-500">
                {card.sub}
              </div>
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
    </div>
  );
}
