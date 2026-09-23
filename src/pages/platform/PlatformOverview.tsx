import { Crown, IndianRupee, Loader2, Sparkles, Users, Wallet } from "lucide-react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { formatInr, planLabel } from "@/lib/platform-admin";
import { cn } from "@/lib/utils";

function formatPurchaseDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const paid = status === "paid";
  const unpaid = status === "unpaid";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        paid && "bg-emerald-50 text-emerald-700",
        unpaid && "bg-red-50 text-red-600",
        status === "cancelled" && "bg-gray-100 text-gray-600",
        !paid && !unpaid && status !== "cancelled" && "bg-amber-50 text-amber-700",
      )}
    >
      {status}
    </span>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function PlatformOverview() {
  const { data, isLoading } = trpc.platform.overview.useQuery();

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[#6B7280]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading platform overview...
      </div>
    );
  }

  const distributionMax = Math.max(1, ...data.planDistribution.map((item) => item.count));
  const visiblePlans = data.planDistribution.filter((item) => item.id !== "trial" || item.count > 0);

  const stats = [
    { label: "Clients", value: String(data.clients), icon: Users },
    { label: "Active Trials", value: String(data.activeTrials), icon: Sparkles },
    { label: "Paid Plans", value: String(data.paidPlans), icon: Crown },
    { label: "Subscription Revenue", value: formatInr(data.subscriptionRevenue), icon: IndianRupee },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px] dark:text-white">
            Platform Overview
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Monitor customers, trials, and subscription activity.
          </p>
        </div>
        <Link
          to="/platform/finance"
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#2563EB] px-4 text-sm font-bold uppercase tracking-wide text-white shadow-sm hover:bg-[#1D4ED8] sm:px-5"
        >
          <Wallet size={16} />
          Finance Center
        </Link>
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 rounded-2xl border border-[#E6E8EC] bg-white px-5 py-4 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium text-[#6B7280]">{stat.label}</p>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#2563EB]">
                <stat.icon size={18} />
              </div>
            </div>
            <p className="mt-4 truncate text-[28px] font-bold leading-none tracking-tight text-[#111827] sm:text-[32px] dark:text-white">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-[#E6E8EC] bg-white p-4 shadow-sm sm:p-5 dark:border-[#1E293B] dark:bg-[#0F172A]">
          <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold text-[#111827] dark:text-white">Recent Subscriptions</h2>
            <Link to="/platform/clients" className="text-sm font-medium text-[#2563EB] hover:underline">
              View All Subscriptions
            </Link>
          </div>
          {data.recentSubscriptions.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#6B7280]">
              No customers yet. New client and staff workspaces will appear here after they sign up.
            </p>
          ) : (
            <div className="divide-y divide-[#F1F3F5] dark:divide-[#1E293B]">
              {data.recentSubscriptions.map((row) => (
                <Link
                  key={row.id}
                  to={`/platform/clients/${row.id}`}
                  className="flex w-full min-w-0 items-start gap-3 rounded-xl py-3.5 hover:bg-[#F8FAFC] sm:items-center dark:hover:bg-white/5"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-sm font-bold text-[#2563EB]">
                    {initials(row.ownerName)}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[#111827] dark:text-white">{row.ownerName}</p>
                      <p className="truncate text-xs text-[#6B7280]">
                        {row.planName || planLabel(row.plan)} · {formatPurchaseDate(row.purchasedAt)} · {row.name}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                      <p className="whitespace-nowrap text-sm font-semibold text-[#111827] dark:text-white">
                        {formatInr(row.subscriptionAmount)}
                      </p>
                      <StatusBadge status={row.planStatus} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-[#E6E8EC] bg-white p-4 shadow-sm sm:p-5 dark:border-[#1E293B] dark:bg-[#0F172A]">
          <h2 className="mb-5 text-base font-semibold text-[#111827] dark:text-white">Plan Distribution</h2>
          <div className="space-y-5">
            {visiblePlans.map((item, index) => {
              const percent = Math.round((item.count / distributionMax) * 100);
              const share =
                item.count === 0
                  ? "0%"
                  : `${Math.round((item.count / Math.max(1, data.clients)) * 100)}%`;
              return (
                <div key={item.id} className="min-w-0">
                  <div className="mb-2 flex min-w-0 items-center justify-between gap-3 text-xs font-bold uppercase tracking-wide text-[#6B7280]">
                    <span className="min-w-0 truncate">{item.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {item.count} · {share}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#EEF0F3] dark:bg-[#1E293B]">
                    <div
                      className={cn(
                        "h-full max-w-full rounded-full",
                        index % 2 === 0 ? "bg-[#4B5563]" : "bg-[#2563EB]",
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
