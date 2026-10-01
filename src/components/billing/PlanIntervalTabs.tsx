import { cn } from "@/lib/utils";
import { planIntervalLabel, type PlanBillingInterval } from "@/lib/platform-admin";

export function PlanIntervalTabs({
  value,
  onChange,
}: {
  value: PlanBillingInterval;
  onChange: (value: PlanBillingInterval) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-[#E6E8EC] bg-[#F8FAFC] p-1 dark:border-[#334155] dark:bg-[#1E293B]">
      {(["month", "year"] as const).map((interval) => (
        <button
          key={interval}
          type="button"
          onClick={() => onChange(interval)}
          className={cn(
            "h-9 rounded-lg px-4 text-sm font-semibold transition-colors",
            value === interval
              ? "bg-white text-[#111827] shadow-sm dark:bg-[#0F172A] dark:text-white"
              : "text-[#6B7280] hover:text-[#111827] dark:hover:text-white",
          )}
        >
          {planIntervalLabel(interval)}
        </button>
      ))}
    </div>
  );
}
