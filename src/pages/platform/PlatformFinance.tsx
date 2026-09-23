import { IndianRupee, Loader2 } from "lucide-react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { formatInr, planLabel } from "@/lib/platform-admin";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  const paid = status === "paid";
  const unpaid = status === "unpaid";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        paid && "bg-emerald-50 text-emerald-700",
        unpaid && "bg-red-50 text-red-600",
        !paid && !unpaid && "bg-amber-50 text-amber-700",
      )}
    >
      {status}
    </span>
  );
}

export default function PlatformFinance() {
  const { data: overview, isLoading: overviewLoading } = trpc.platform.overview.useQuery();
  const { data: clients, isLoading } = trpc.platform.listClients.useQuery({});

  const billed = (clients ?? []).filter((row) => row.planStatus !== "trial");
  const unpaidTotal = billed
    .filter((row) => row.planStatus === "unpaid")
    .reduce((sum, row) => sum + row.subscriptionAmount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#111827] sm:text-[28px] dark:text-white">
          Finance Center
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Subscription collections across every Aaso customer workspace.
        </p>
      </div>

      {overviewLoading || !overview ? (
        <div className="flex items-center justify-center py-16 text-[#6B7280]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading finance...
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#E6E8EC] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
            <p className="text-sm text-[#6B7280]">Collected revenue</p>
            <p className="mt-3 text-3xl font-bold">{formatInr(overview.subscriptionRevenue)}</p>
          </div>
          <div className="rounded-2xl border border-[#E6E8EC] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
            <p className="text-sm text-[#6B7280]">Outstanding</p>
            <p className="mt-3 text-3xl font-bold">{formatInr(unpaidTotal)}</p>
          </div>
          <div className="rounded-2xl border border-[#E6E8EC] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
            <p className="text-sm text-[#6B7280]">Paid plans</p>
            <p className="mt-3 text-3xl font-bold">{overview.paidPlans}</p>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-[#E6E8EC] bg-white shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
        <div className="border-b border-[#EEF0F3] px-5 py-4 dark:border-[#1E293B]">
          <h2 className="font-semibold">Subscription ledger</h2>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[#6B7280]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading...
          </div>
        ) : !billed.length ? (
          <p className="py-16 text-center text-sm text-[#6B7280]">No billed subscriptions yet.</p>
        ) : (
          <div className="divide-y divide-[#F1F3F5] dark:divide-[#1E293B]">
            {billed.map((row) => (
              <Link
                key={row.id}
                to={`/platform/clients/${row.id}`}
                className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-4 hover:bg-[#F8FAFC] sm:flex-nowrap sm:px-5 dark:hover:bg-white/5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#2563EB]">
                  <IndianRupee size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{row.name}</p>
                  <p className="truncate text-xs text-[#6B7280]">
                    {row.ownerName} · {planLabel(row.plan)}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-3">
                  <p className="text-sm font-semibold">{formatInr(row.subscriptionAmount)}</p>
                  <StatusBadge status={row.planStatus} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
