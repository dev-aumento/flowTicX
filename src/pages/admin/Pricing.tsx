import { Check, CreditCard, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  formatInr,
  formatPlanDate,
  formatPlanDuration,
  PLAN_FEATURE_CATALOG,
  statusLabel,
} from "@/lib/platform-admin";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function AdminPricing() {
  const utils = trpc.useUtils();
  const { data: plans, isLoading } = trpc.subscription.plans.useQuery();
  const { data: current } = trpc.subscription.current.useQuery();
  const select = trpc.subscription.selectPlan.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.auth.me.invalidate(),
        utils.subscription.current.invalidate(),
        utils.subscription.plans.invalidate(),
      ]);
      toast.success(`${result.planName ?? "Plan"} is now active`);
    },
    onError: (error) => toast.error(error.message),
  });

  const currentSlug = current?.plan ?? "";
  const featuredSlug =
    plans?.find((plan) => plan.slug !== "trial" && plan.slug !== currentSlug)?.slug ??
    plans?.[1]?.slug ??
    null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#111827] dark:text-white">
          Pricing
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Choose an Aaso plan. Menu items follow the modules included in the selected plan.
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
              {formatInr(current.subscriptionAmount)} ·{" "}
              {current.durationDays ? formatPlanDuration(current.durationDays) : "Custom"}
              {current.planExpiresAt ? ` · Ends ${formatPlanDate(current.planExpiresAt)}` : ""}
            </p>
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-[#6B7280]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading pricing plans...
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {(plans ?? []).map((plan) => {
            const selected = plan.slug === currentSlug;
            const featured = !selected && plan.slug === featuredSlug;
            return (
              <article
                key={plan.slug}
                className={cn(
                  "flex flex-col rounded-2xl border bg-white p-5 shadow-sm dark:bg-[#0F172A]",
                  selected
                    ? "border-[#2563EB] ring-2 ring-[#2563EB]/20 dark:border-blue-400"
                    : featured
                      ? "border-[#2563EB]/40 dark:border-blue-500/40"
                      : "border-[#E6E8EC] dark:border-[#1E293B]",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-[#111827] dark:text-white">{plan.name}</h2>
                    <p className="mt-1 text-sm text-[#6B7280]">{plan.description}</p>
                  </div>
                  {selected ? (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      Selected
                    </span>
                  ) : featured ? (
                    <span className="rounded-md bg-[#EEF4FF] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2563EB] dark:bg-blue-500/15 dark:text-blue-200">
                      Popular
                    </span>
                  ) : null}
                </div>

                <p className="mt-4 text-3xl font-bold tracking-tight text-[#111827] dark:text-white">
                  {formatInr(plan.amount)}
                </p>
                <p className="mt-1 text-sm text-[#6B7280]">{formatPlanDuration(plan.durationDays)}</p>

                <ul className="mt-5 flex-1 space-y-2">
                  {PLAN_FEATURE_CATALOG.filter((feature) => plan.featureKeys.includes(feature.key)).map(
                    (feature) => (
                      <li key={feature.key} className="flex items-start gap-2 text-sm text-[#111827] dark:text-slate-100">
                        <Check size={15} className="mt-0.5 shrink-0 text-[#2563EB]" />
                        <span>
                          <span className="font-medium">{feature.label}</span>
                          <span className="block text-xs text-[#6B7280]">{feature.description}</span>
                        </span>
                      </li>
                    ),
                  )}
                </ul>

                <button
                  type="button"
                  disabled={selected || select.isPending}
                  onClick={() => select.mutate({ slug: plan.slug })}
                  className={cn(
                    "mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60",
                    selected
                      ? "border border-[#E6E8EC] bg-[#F8FAFC] text-[#6B7280] dark:border-[#334155] dark:bg-[#1E293B] dark:text-slate-300"
                      : "bg-[#2563EB] text-white hover:bg-[#1D4ED8]",
                  )}
                >
                  {select.isPending && select.variables?.slug === plan.slug ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CreditCard size={16} />
                  )}
                  {selected ? "Current plan" : "Select plan"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
