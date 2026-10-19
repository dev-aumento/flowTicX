import { Link } from "react-router";
import { AASO_SITE_URL } from "@/components/brand/BrandLogo";

/** Public pricing page header: logo, Sign In, and Start Free Trial (no nav menu). */
export function PricingHeader({ plansAnchor }: { plansAnchor: string }) {
  // Glass bar: translucent white + backdrop blur. Uses box-shadow, not drop-shadow, because a CSS
  // filter on the same element disables backdrop-filter in Chromium.
  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-white/65 shadow-[0px_1px_4px_rgba(0,0,0,0.04),0px_8px_24px_-12px_rgba(15,23,42,0.12)] backdrop-blur-[16px] backdrop-saturate-[1.8] supports-[not(backdrop-filter:blur(1px))]:bg-white/95">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-4 sm:h-20 sm:px-6 lg:px-8">
        <a href={AASO_SITE_URL} aria-label="aaso home" className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <img src="/pricing/aaso-mark.svg" alt="" width={53} height={40} className="h-7 w-auto sm:h-10" />
          <img src="/pricing/aaso-wordmark.svg" alt="aaso" width={127} height={32} className="h-[22px] w-auto sm:h-8" />
        </a>

        <div className="flex items-center gap-1 sm:gap-3">
          <Link
            to="/login"
            className="rounded-[8px] px-2.5 py-2 text-sm font-semibold leading-5 text-[#2563eb] hover:bg-[rgba(37,99,235,0.08)] sm:px-4 sm:text-base"
          >
            Sign In
          </Link>
          <a
            href={`#${plansAnchor}`}
            className="rounded-[8px] bg-[#2563eb] px-3.5 py-2.5 text-sm font-semibold leading-5 text-white shadow-[0px_2px_5px_rgba(29,78,216,0.2)] hover:bg-[#1d4ed8] sm:px-6 sm:py-3 sm:text-base"
          >
            Start Free Trial
          </a>
        </div>
      </div>
    </header>
  );
}
