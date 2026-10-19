import { CircleCheck, Loader2 } from "lucide-react";
import {
  formatPlanMoney,
  planPriceForCurrency,
  planPriceSuffix,
  type PlanDisplayCurrency,
  type PlatformPlan,
} from "@/lib/platform-admin";
import { PLAN_HIGHLIGHTS, isPopularPlan, planChecklist, teamMemberLabel } from "@/lib/plan-entitlements";
import { cn } from "@/lib/utils";

/** Lines in the first checklist group. An "Everything in …" line rides on top of these. */
const CORE_LINES = 4;

const INCLUDE_KEYS = new Set(PLAN_HIGHLIGHTS.filter((item) => item.includes?.length).map((item) => item.key));

/**
 * Checklist split into a core group and an extended group. Plans that build on a lower
 * tier ("Everything in …") skip the project allowance line, which the lower tier already lists.
 */
function checklistGroups(plan: PlatformPlan) {
  const builds = plan.highlightKeys.some((key) => INCLUDE_KEYS.has(key));
  const lines = planChecklist(plan).slice(builds ? 1 : 0);
  const split = CORE_LINES + (builds ? 1 : 0);
  return [lines.slice(0, split), lines.slice(split)].filter((group) => group.length > 0);
}

export function PricingPlanCard({
  plan,
  currency,
  selected = false,
  ctaLabel,
  savingsPercent,
  disabled = false,
  pending = false,
  onSelect,
}: {
  plan: PlatformPlan;
  currency: PlanDisplayCurrency;
  selected?: boolean;
  ctaLabel: string;
  /** Yearly saving against the monthly plan, shown as a green "Save N%" pill under the price. */
  savingsPercent?: number;
  disabled?: boolean;
  pending?: boolean;
  onSelect: () => void;
}) {
  const popular = isPopularPlan(plan);
  const groups = checklistGroups(plan);

  return (
    <article
      className={cn(
        "relative flex h-full flex-col gap-4 rounded-[12px] border-[1.5px] p-4",
        popular
          ? "border-[#e5eeff] bg-[rgba(37,99,235,0.2)] shadow-[0px_1.5px_3px_0px_rgba(0,0,0,0.05)]"
          : "border-[#e5eeff] bg-white drop-shadow-[0px_1.5px_1.5px_rgba(0,0,0,0.05)]",
        selected && "ring-2 ring-[#2563eb]/40",
      )}
    >
      {plan.badge ? (
        <span
          className={cn(
            "absolute right-3 top-0 -translate-y-1/2 rounded-[84px] px-[10px] py-[3px] font-['Plus_Jakarta_Sans'] text-[13px] font-medium uppercase leading-[18px]",
            popular ? "bg-[#2563eb] text-white" : "bg-[#d5e0e9] text-black",
          )}
        >
          {plan.badge}
        </span>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="font-['Inter'] text-xl font-bold leading-normal text-[#0b1c30]">{plan.name}</h3>
        <p className="min-h-10 text-sm leading-5 text-[#434655]">{plan.description}</p>
      </div>

      <hr className="border-t-[1.5px] border-[#e5eeff]" />

      <div className="flex flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-0.5 text-[#0b1c30]">
          <span className="text-[32px] font-bold leading-none">
            {formatPlanMoney(planPriceForCurrency(plan, currency), currency)}
          </span>
          <span className="text-base leading-6 text-[#434655]">{planPriceSuffix(plan.durationDays)}</span>
        </p>
        {savingsPercent ? (
          <span className="mt-1.5 self-start rounded-full bg-[#dcf5e6] px-2.5 py-[3px] text-xs font-semibold leading-4 text-[#166534]">
            Save {savingsPercent}%
          </span>
        ) : null}
        <p className="text-[15px] font-semibold text-black">{teamMemberLabel(plan.limits.teamMembers)}</p>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-[8px] border px-5 py-[10px] text-base font-semibold leading-5 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          popular
            ? "border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
            : "border-[#2563eb] bg-[rgba(37,99,235,0.1)] text-[#2563eb] hover:bg-[rgba(37,99,235,0.16)]",
        )}
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : null}
        {ctaLabel}
      </button>

      <div className="flex flex-1 flex-col gap-4">
        {groups.map((group, index) => (
          <ul
            key={index}
            className={cn("flex flex-col gap-4", index > 0 && "border-t-[1.5px] border-[#e5eeff] pt-4")}
          >
            {group.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[13px] leading-[18px] text-[#434655]">
                <CircleCheck size={16} strokeWidth={1.75} aria-hidden className="mt-px shrink-0 text-[#434655]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </article>
  );
}
