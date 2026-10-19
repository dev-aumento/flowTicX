import { cn } from "@/lib/utils";
import { planIntervalLabel, type PlanBillingInterval } from "@/lib/platform-admin";

/** Public pricing page Monthly / Yearly switch with the "Save up to 20%" note. */
export function PricingIntervalToggle({
  value,
  onChange,
}: {
  value: PlanBillingInterval;
  onChange: (value: PlanBillingInterval) => void;
}) {
  return (
    <div className="relative flex flex-col items-center gap-2">
      <div
        role="tablist"
        aria-label="Billing interval"
        className="flex items-center rounded-[10px] bg-[rgba(140,157,172,0.2)] p-[6px] shadow-[0px_8px_14px_-8px_rgba(9,20,35,0.18)]"
      >
        {(["month", "year"] as const).map((interval) => {
          const active = value === interval;
          return (
            <button
              key={interval}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(interval)}
              className={cn(
                "px-5 py-[15.5px] text-base font-semibold leading-none transition-colors",
                active
                  ? "rounded-[8px] bg-[#2563eb] text-white drop-shadow-[0px_9px_24.5px_rgba(9,20,35,0.08)]"
                  : "rounded-[4px] bg-[#e9ecf3] text-[#8c9dac] hover:text-[#434655]",
              )}
            >
              {planIntervalLabel(interval)}
            </button>
          );
        })}
      </div>

      {/* Hangs off the right of the toggle so the toggle itself stays centered. */}
      <div
        aria-hidden
        className="pointer-events-none flex select-none items-center sm:absolute sm:left-full sm:top-1/2 sm:ml-[15px] sm:-translate-y-1/2 sm:whitespace-nowrap"
      >
        <span className="mr-[-10px] hidden h-[64px] w-[72px] items-center justify-center sm:flex">
          <img
            src="/pricing/yearly-savings-arrow.svg"
            alt=""
            width={60}
            height={42}
            className="max-w-none -rotate-[26.24deg]"
          />
        </span>
        <span className="flex flex-col items-center font-['Caveat'] sm:items-start">
          <span className="text-[25.5px] font-bold leading-[31.875px] text-[#047857]">Save up to 20%</span>
          <span className="-mt-[1.5px] text-[22.5px] font-normal leading-[28.125px] text-[rgba(4,120,87,0.9)]">
            with yearly billing
          </span>
        </span>
      </div>
    </div>
  );
}
