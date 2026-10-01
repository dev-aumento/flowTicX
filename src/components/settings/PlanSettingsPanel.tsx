import { Check, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  detectPlanCurrency,
  formatPlanDate,
  formatPlanDuration,
  formatPlanMoney,
  planBillingInterval,
  planIntervalLabel,
  planPriceForCurrency,
  statusLabel,
} from "@/lib/platform-admin";
import { planChecklist, resolvePlanEntitlement } from "@/lib/plan-entitlements";

const AASO_PRICING_URL = "https://aaso.tech/pricing/";

export function PlanSettingsPanel() {
  const currentQuery = trpc.subscription.current.useQuery();
  const plansQuery = trpc.subscription.plans.useQuery();
  const current = currentQuery.data;
  const catalog = (plansQuery.data ?? []).find((plan) => plan.slug === current?.plan);

  if (currentQuery.isLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-sm text-gray-500">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Loading plan...
      </div>
    );
  }

  if (currentQuery.error || !current) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[#1F2937]">Plans</h2>
        <p className="text-sm text-red-500">
          {currentQuery.error?.message || "Could not load the active plan."}
        </p>
      </div>
    );
  }

  const entitlement = resolvePlanEntitlement({
    slug: current.plan ?? "trial",
    limits: catalog?.limits ?? current.planLimits,
    highlightKeys: catalog?.highlightKeys,
    badge: catalog?.badge,
    ctaLabel: catalog?.ctaLabel,
    storageLabel: catalog?.storageLabel,
    entitlementsConfigured: catalog?.entitlementsConfigured,
  });
  const included = planChecklist({
    limits: entitlement.limits,
    highlightKeys: entitlement.highlightKeys,
    storageLabel: entitlement.storageLabel,
  });
  const planName = current.planName || catalog?.name || "Trial";
  const currency = detectPlanCurrency();
  const durationDays = current.durationDays ?? catalog?.durationDays ?? null;
  const intervalLabel = catalog ? planIntervalLabel(planBillingInterval(catalog)) : null;
  const price = catalog
    ? planPriceForCurrency(catalog, currency)
    : currency === "INR"
      ? current.subscriptionAmount ?? 0
      : 0;
  const details = [
    formatPlanMoney(price, currency),
    intervalLabel,
    durationDays ? formatPlanDuration(durationDays) : null,
    current.planExpiresAt ? `Ends ${formatPlanDate(current.planExpiresAt)}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#1F2937]">Plans</h2>
          <p className="mt-0.5 text-sm text-gray-500">Your workspace subscription</p>
        </div>
        <a
          href={AASO_PRICING_URL}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#2563EB] to-[#3B82F6] px-5 text-sm font-semibold text-white hover:shadow-lg hover:shadow-blue-200"
        >
          Upgrade plan
        </a>
      </div>

      <section className="rounded-xl border border-gray-200 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
          Active plan
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-semibold text-[#1F2937]">{planName}</h3>
          <span className="rounded-md bg-[#EEF4FF] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#2563EB]">
            {statusLabel(current.planStatus)}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-gray-500">{details.join(" · ")}</p>
        {catalog?.description ? (
          <p className="mt-2 text-sm text-gray-600">{catalog.description}</p>
        ) : null}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-[#1F2937]">Included in this plan</h3>
        {included.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No included details are listed for this plan.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {included.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-[#1F2937]">
                <Check size={16} className="mt-0.5 shrink-0 text-[#2563EB]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
