import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { formatInr, planPriceSuffix, type PlatformPlan } from "@/lib/platform-admin";
import { isPopularPlan, planChecklist, teamMemberLabel } from "@/lib/plan-entitlements";
import { cn } from "@/lib/utils";

export function PlanPricingCard({
  plan,
  selected = false,
  plain = false,
  action,
  footer,
}: {
  plan: PlatformPlan;
  selected?: boolean;
  /** Master admin catalog: no marketing badge or highlighted border. */
  plain?: boolean;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  const featured = !plain && isPopularPlan(plan) && !selected;
  const lines = planChecklist(plan);

  return (
    <article
      className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-white px-5 pb-5 shadow-sm dark:bg-[#0F172A]",
        plain ? "pt-5" : "pt-7",
        selected
          ? "border-[#2563EB] ring-2 ring-[#2563EB]/20 dark:border-blue-400"
          : featured
            ? "border-[#93C5FD] bg-[#F5F8FF] dark:border-blue-500/40 dark:bg-blue-500/10"
            : "border-[#E6E8EC] dark:border-[#1E293B]",
      )}
    >
      {!plain && plan.badge ? (
        <span
          className={cn(
            "absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em]",
            featured || /most popular/i.test(plan.badge)
              ? "bg-[#2563EB] text-white"
              : "bg-[#EEF4FF] text-[#2563EB] dark:bg-blue-500/15 dark:text-blue-200",
          )}
        >
          {plan.badge}
        </span>
      ) : null}

      <h2 className="text-lg font-semibold text-[#111827] dark:text-white">{plan.name}</h2>
      <p className="mt-1 min-h-10 text-sm leading-5 text-[#6B7280]">{plan.description}</p>

      <p className="mt-4 text-[32px] font-bold leading-none tracking-tight text-[#111827] dark:text-white">
        {formatInr(plan.amount)}
        <span className="ml-1 text-sm font-medium text-[#6B7280]">{planPriceSuffix(plan.durationDays)}</span>
      </p>
      <p className="mt-2 text-sm font-medium text-[#111827] dark:text-slate-200">
        {teamMemberLabel(plan.limits.teamMembers)}
      </p>

      {action ? <div className="mt-4">{action}</div> : null}

      <ul className="mt-4 flex-1 space-y-2.5 border-t border-[#E6E8EC] pt-4 dark:border-[#334155]">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2 text-sm text-[#111827] dark:text-slate-100">
            <Check size={16} className="mt-0.5 shrink-0 text-[#2563EB]" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {footer ? <div className="mt-4">{footer}</div> : null}
    </article>
  );
}
