import { Fragment, useId, useState } from "react";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const PLANS = ["Free", "Starter", "Growth", "Business", "Enterprise"] as const;
/** Column highlighted in brand blue, matching the "Most popular" card. */
const HIGHLIGHT = PLANS.indexOf("Growth");

type Row = { feature: string; values: [string, string, string, string, string] };
type Group = { title: string; rows: Row[] };

const DASH = "—";

const GROUPS: Group[] = [
  {
    title: "Workspace & User Seats",
    rows: [
      { feature: "Team Member Limit", values: ["5 members", "10 members", "25 members", "50 members", "100 members"] },
      { feature: "Active Projects", values: ["3 projects", "Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      { feature: "Cloud File Storage", values: ["1 GB", "5 GB", "25 GB", "100 GB", "500 GB"] },
    ],
  },
  {
    title: "Client Management & Portals",
    rows: [
      { feature: "Unlimited Client Guests", values: ["✓ Included", "✓ Included", "✓ Included", "✓ Included", "✓ Included"] },
      { feature: "White-label Custom Domain Portal", values: [DASH, DASH, "Included", "Included", "Included"] },
      { feature: "Client Approvals & E-Signatures", values: [DASH, "Basic", "Unlimited", "Unlimited", "Unlimited"] },
    ],
  },
  {
    title: "Time, Billing & Profitability",
    rows: [
      { feature: "Timesheets & Live Timer", values: ["Basic", "Advanced", "Advanced + AI", "Advanced + AI", "Advanced + AI"] },
      { feature: "Multi-Currency Invoicing & Stripe Sync", values: [DASH, DASH, "Included", "Included", "Included"] },
      { feature: "Project Profitability & Margin Forecasting", values: [DASH, DASH, "Real-time", "Real-time", "Real-time"] },
    ],
  },
  {
    title: "Security, Compliance & Support",
    rows: [
      { feature: "SAML 2.0 Single Sign-On (SSO)", values: [DASH, DASH, DASH, DASH, "Included"] },
      { feature: "Dedicated Account Manager & SLA", values: [DASH, DASH, DASH, "Optional SLA", "99.9% SLA"] },
    ],
  },
];

// The feature column stays pinned while the plan columns scroll sideways on narrow screens.
const STICKY = "sticky left-0 z-10 shadow-[1px_0_0_#e5eeff] lg:shadow-none";

export function PricingComparison() {
  const [open, setOpen] = useState(true);
  const tableId = useId();

  return (
    <section className="px-4 py-10 sm:px-6 sm:py-[60px] lg:px-8">
      <div className="mx-auto max-w-[1440px] rounded-[16px] shadow-[0px_2px_7.5px_rgba(0,0,0,0.1)]">
        <div
          className={cn(
            "flex flex-col gap-6 rounded-t-[16px] bg-[rgba(239,244,255,0.7)] px-5 py-7 md:py-9 lg:flex-row lg:items-center lg:justify-between",
            !open && "rounded-b-[16px]",
          )}
        >
          <div className="flex flex-col gap-3 md:gap-4">
            <p className="text-sm font-semibold uppercase text-[#2563eb]">Deep dive</p>
            <h2 className="text-[28px] font-extrabold leading-tight text-black md:text-[36px] md:leading-normal">
              Detailed Feature Comparison
            </h2>
            <p className="text-base leading-6 text-[#8c9dac]">
              Everything you need to select the right operational tier for your firm.
            </p>
          </div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={tableId}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex shrink-0 items-center justify-center gap-[18px] self-start rounded-[10px] border border-[#2563eb] bg-[rgba(37,99,235,0.1)] px-6 py-[15px] text-base font-semibold leading-5 text-[#2563eb] transition-colors hover:bg-[rgba(37,99,235,0.16)] lg:self-auto"
          >
            {open ? "Collapse Comparison Table" : "Expand Comparison Table"}
            <ChevronUp size={16} strokeWidth={2.25} aria-hidden className={cn("transition-transform", !open && "rotate-180")} />
          </button>
        </div>

        <div
          id={tableId}
          hidden={!open}
          className="overflow-x-auto rounded-b-[16px] bg-[rgba(229,238,255,0.8)]"
        >
          <table className="w-full min-w-[720px] border-separate md:min-w-[1000px] lg:min-w-0 border-spacing-0 text-left">
            <thead>
              <tr className="bg-white">
                <th scope="col" className={cn(STICKY, "w-[150px] min-w-[150px] bg-white px-4 py-5 text-base font-bold text-black md:w-[30%] md:min-w-[300px] md:p-5 md:text-lg lg:min-w-[240px] xl:min-w-[300px]")}>
                  Feature Area
                </th>
                {PLANS.map((plan, index) => (
                  <th
                    key={plan}
                    scope="col"
                    className={cn(
                      "px-3 py-5 text-base font-bold md:text-lg lg:px-2 xl:px-3",
                      index === HIGHLIGHT ? "text-[#2563eb]" : "text-black",
                    )}
                  >
                    {plan}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((group) => (
                <Fragment key={group.title}>
                  <tr>
                    <th scope="colgroup" colSpan={PLANS.length + 1} className="p-0 text-left">
                      <span className="sticky left-0 inline-block px-4 py-5 text-sm font-semibold uppercase text-black md:p-5 md:text-base">
                        {group.title}
                      </span>
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.feature} className="bg-white">
                      <th
                        scope="row"
                        className={cn(STICKY, "bg-white px-4 py-5 text-sm font-medium text-black md:px-5 md:py-[22px] md:text-base")}
                      >
                        {row.feature}
                      </th>
                      {row.values.map((value, index) => (
                        <td
                          key={PLANS[index]}
                          className={cn(
                            "whitespace-nowrap px-3 py-5 text-sm md:py-[22px] md:text-base lg:px-2 xl:px-3",
                            index === HIGHLIGHT && value !== DASH ? "text-[#2563eb]" : "text-[#434655]",
                          )}
                        >
                          {value === DASH ? <span aria-label="Not included">{DASH}</span> : value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
