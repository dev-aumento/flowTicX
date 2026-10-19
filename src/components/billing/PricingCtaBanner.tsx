import { AASO_SITE_URL } from "@/components/brand/BrandLogo";

const ctaFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#2563eb]";

/**
 * Closing blue banner under the FAQ: trial pitch with a ghost and a white CTA.
 * `trialHref` is the register form on app.aaso.tech, or a `#` anchor back to the plans.
 */
export function PricingCtaBanner({ trialHref }: { trialHref: string }) {
  const trialClassName = `rounded-[10px] border border-white bg-white px-5 py-[14px] text-base font-semibold leading-5 text-[#2563eb] shadow-[0px_24px_35px_rgba(9,20,35,0.28)] transition-colors hover:bg-[#eff4ff] ${ctaFocus}`;

  return (
    <section className="px-4 pb-12 sm:px-6 sm:pb-16 lg:px-8 lg:pb-20">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center gap-8 rounded-[24px] bg-[#2563eb] px-5 py-10 text-center shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)] sm:gap-10 sm:px-10 sm:py-14 lg:p-16">
        <div className="flex max-w-[602px] flex-col items-center gap-3 sm:gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.02em] text-white sm:text-sm">
            Ready to modernize your operations?
          </p>
          <h2 className="text-[28px] font-extrabold leading-tight text-white sm:text-[36px] sm:leading-normal">
            Start your 30 day free trial now
          </h2>
          <p className="text-sm leading-6 text-white/90 sm:text-base">
            Experience how 500+ service organizations eliminate app fatigue, accelerate billables, and delight their
            clients.
          </p>
        </div>

        {/* Stacked full width on phones with the primary action first; side by side from sm up. */}
        <div className="flex w-full max-w-[360px] flex-col-reverse gap-3 sm:w-auto sm:max-w-none sm:flex-row sm:gap-4">
          <a
            href={`${AASO_SITE_URL}/contact/`}
            className={`rounded-[10px] border border-white px-5 py-[14px] text-base font-semibold leading-5 text-white transition-colors hover:bg-white/10 ${ctaFocus}`}
          >
            Talk to a Specialist
          </a>
          <a href={trialHref} className={trialClassName}>
            Start Free Trial
          </a>
        </div>
      </div>
    </section>
  );
}
