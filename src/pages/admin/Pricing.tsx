import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  formatPlanDate,
  formatPlanDuration,
  formatPlanMoney,
  planBillingInterval,
  planIntervalLabel,
  sortPlansByPrice,
  planPriceForCurrency,
  statusLabel,
  type PlanBillingInterval,
} from "@/lib/platform-admin";
import { isPopularPlan } from "@/lib/plan-entitlements";
import { PlanPricingCard } from "@/components/billing/PlanPricingCard";
import { PlanIntervalTabs } from "@/components/billing/PlanIntervalTabs";
import { completePlanCheckout, RazorpayCheckoutClosed } from "@/lib/razorpay-checkout";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function AdminPricing() {
  const utils = trpc.useUtils();
  const { data: plans, isLoading } = trpc.subscription.plans.useQuery();
  const { data: current } = trpc.subscription.current.useQuery();
  const beginCheckout = trpc.subscription.beginCheckout.useMutation();
  const confirmPayment = trpc.subscription.confirmPayment.useMutation();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const currency = "INR" as const;
  const [interval, setInterval] = useState<PlanBillingInterval>("month");
  const [syncedInterval, setSyncedInterval] = useState(false);
  const currentSlug = current?.plan ?? "";
  const activePlan = (plans ?? []).find((plan) => plan.slug === currentSlug);

  useEffect(() => {
    if (syncedInterval || !activePlan) return;
    setInterval(planBillingInterval(activePlan));
    setSyncedInterval(true);
  }, [activePlan, syncedInterval]);

  const visiblePlans = useMemo(
    () =>
      sortPlansByPrice((plans ?? []).filter((plan) => planBillingInterval(plan) === interval)),
    [plans, interval],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#111827] dark:text-white">
          Pricing
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Choose an Aaso plan. Paid plans open Razorpay and start after the payment succeeds. Projects, team size, and menu access follow the limits on the selected plan.
        </p>
      </div>

      {current ? (
        <section className="rounded-2xl border border-[#E6E8EC] bg-white px-5 py-4 shadow-sm dark:border-[#1E293B] dark:bg-[#0F172A]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF]">
            Current plan
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-lg font-semibold text-[#111827] dark:text-white">
              {current.planName ?? "Trial"}
            </p>
            <span className="rounded-md bg-[#EEF4FF] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#2563EB] dark:bg-blue-500/15 dark:text-blue-200">
              {statusLabel(current.planStatus)}
            </span>
            <p className="text-sm text-[#6B7280]">
              {formatPlanMoney(
                activePlan
                  ? planPriceForCurrency(activePlan, currency)
                  : currency === "INR"
                    ? current.subscriptionAmount
                    : 0,
                currency,
              )}
              {activePlan ? ` · ${planIntervalLabel(planBillingInterval(activePlan))}` : ""}
              {current.durationDays ? ` · ${formatPlanDuration(current.durationDays)}` : ""}
              {current.planExpiresAt ? ` · Ends ${formatPlanDate(current.planExpiresAt)}` : ""}
            </p>
          </div>
        </section>
      ) : null}

      <PlanIntervalTabs value={interval} onChange={setInterval} />

      {isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-[#6B7280]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading pricing plans...
        </div>
      ) : visiblePlans.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#E6E8EC] px-5 py-10 text-center text-sm text-[#6B7280] dark:border-[#334155]">
          No {interval === "year" ? "yearly" : "monthly"} plans are available yet.
        </p>
      ) : (
        <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {visiblePlans.map((plan) => {
            const selected = plan.slug === currentSlug;
            const featured = isPopularPlan(plan);
            const pending = pendingSlug === plan.slug;
            return (
              <PlanPricingCard
                key={plan.slug}
                plan={plan}
                selected={selected}
                currency={currency}
                action={
                  <button
                    type="button"
                    disabled={selected || pendingSlug != null}
                    onClick={() => {
                      setPendingSlug(plan.slug);
                      void completePlanCheckout(
                        plan.slug,
                        (input) => beginCheckout.mutateAsync(input),
                        (proof) => confirmPayment.mutateAsync(proof),
                      )
                        .then(async (result) => {
                          await Promise.all([
                            utils.auth.me.invalidate(),
                            utils.subscription.current.invalidate(),
                            utils.subscription.plans.invalidate(),
                          ]);
                          toast.success(`${result.planName ?? "Plan"} is now active`);
                        })
                        .catch((error: unknown) => {
                          if (error instanceof RazorpayCheckoutClosed) return;
                          toast.error(error instanceof Error ? error.message : "Payment could not be completed");
                        })
                        .finally(() => setPendingSlug(null));
                    }}
                    className={cn(
                      "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60",
                      selected
                        ? "border border-[#E6E8EC] bg-white text-[#6B7280] dark:border-[#334155] dark:bg-[#1E293B] dark:text-slate-300"
                        : featured
                          ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                          : "border border-[#2563EB] bg-white text-[#2563EB] hover:bg-[#EEF4FF] dark:bg-transparent dark:text-blue-200",
                    )}
                  >
                    {pending ? <Loader2 size={16} className="animate-spin" /> : null}
                    {selected ? "Current plan" : plan.amount > 0 ? "Pay now" : plan.ctaLabel || "Select plan"}
                  </button>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
