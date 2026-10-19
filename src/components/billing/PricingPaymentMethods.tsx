import type { ReactNode } from "react";

/** Wordmark badges, styled like each provider's logo text. */
const METHODS: { name: string; mark: ReactNode }[] = [
  {
    name: "Visa",
    mark: <span className="font-['Plus_Jakarta_Sans'] font-black tracking-[0.05em] text-[#1e40af]">VISA</span>,
  },
  {
    name: "Mastercard",
    mark: (
      <span className="flex">
        <span className="size-6 rounded-full bg-[#ef4444] opacity-90" />
        <span className="-ml-1.5 size-6 rounded-full bg-[#f59e0b] opacity-90" />
      </span>
    ),
  },
  {
    name: "Razorpay",
    mark: <span className="font-['Plus_Jakarta_Sans'] font-bold tracking-[-0.025em] text-[#0c2340]">Razorpay</span>,
  },
  {
    name: "PayPal",
    mark: <span className="font-['Plus_Jakarta_Sans'] font-bold tracking-[-0.025em] text-[#003087]">PayPal</span>,
  },
  {
    name: "UPI",
    mark: <span className="font-['Plus_Jakarta_Sans'] text-[0.857em] font-black text-[#097939]">UPI</span>,
  },
  {
    name: "Stripe",
    mark: <span className="font-['Plus_Jakarta_Sans'] font-bold tracking-[-0.025em] text-[#635bff]">stripe</span>,
  },
];

export function PricingPaymentMethods() {
  return (
    <section className="px-4 pb-10 sm:px-6 sm:pb-[60px] lg:px-8">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 rounded-[24px] border-[1.5px] border-[#e5eeff] bg-[rgba(239,244,255,0.7)] px-5 py-6 sm:px-[41.5px] sm:py-[37.5px] xl:flex-row xl:items-center xl:justify-between xl:gap-4">
        <div className="flex items-start gap-4 sm:items-center sm:gap-[18px]">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-[#e5eeff] sm:size-[60px]">
            <img src="/pricing/payment-card.svg" alt="" width={25} height={20} />
          </span>
          <div className="flex flex-col gap-1.5 sm:gap-2.5">
            <h3 className="font-['Inter'] text-lg font-semibold text-black sm:text-xl">
              Accepted Payment Methods &amp; Currencies
            </h3>
            <p className="text-sm leading-6 text-[#434655] sm:text-base">
              Instant activation • Subscriptions in USD ($) or INR (₹) with compliant tax invoices
            </p>
          </div>
        </div>

        {/* Badges and the SSL note share a row on tablets; on desktop they join the main row. */}
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between xl:contents">
          <ul
            aria-label="Payment methods"
            className="flex flex-wrap gap-2.5 text-lg sm:text-[21px] xl:w-[420px] xl:shrink-0 xl:justify-center xl:px-5"
          >
            {METHODS.map(({ name, mark }) => (
              <li
                key={name}
                aria-label={name}
                className="flex h-[44px] items-center justify-center rounded-[6px] border-[1.5px] border-[rgba(196,197,215,0.3)] bg-white px-3.5 leading-none drop-shadow-[0px_1.5px_1.5px_rgba(0,0,0,0.05)] sm:h-[51px] sm:px-[19.5px]"
              >
                {mark}
              </li>
            ))}
          </ul>

          <p className="flex shrink-0 items-center gap-3 text-base leading-6 text-[#434655]">
            <img src="/pricing/ssl-lock.svg" alt="" width={15} height={20} />
            256-bit SSL Encrypted
          </p>
        </div>
      </div>
    </section>
  );
}
