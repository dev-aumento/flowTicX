const INDUSTRIES = [
  "Project Management",
  "Client Portal",
  "Time Tracking",
  "HR & People",
  "Finance & Invoicing",
];

export function PricingHero() {
  return (
    <section className="relative isolate flex overflow-hidden flex-col items-center px-4 py-10 sm:px-8 sm:py-[60px]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-96px] -z-10 h-[380px] w-full max-w-[850px] -translate-x-1/2 rounded-[12px] bg-gradient-to-b from-[rgba(220,225,255,0.3)] via-[rgba(229,238,255,0.2)] to-[rgba(229,238,255,0)] blur-[32px]"
      />

      <div className="relative flex w-full max-w-[896px] flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-[18px] text-center">
          <p className="rounded-br-[16px] rounded-tl-[16px] bg-[#dce9ff] px-[14px] py-[10px] text-xs font-semibold uppercase text-[#2563eb] drop-shadow-[0px_1px_1px_rgba(0,0,0,0.05)] sm:text-sm">
            Simple pricing. Complete solution.
          </p>
          <h1 className="text-[34px] font-extrabold leading-tight text-[#0b1c30] sm:text-[44px] lg:text-[52px] lg:leading-[66px]">
            One Platform for Your{" "}  
            <span className="relative text-[#2563eb]">
              Entire
              <HeroAnnotation />
            </span>
            <br className="hidden sm:block" /> <span className="text-[#2563eb]">Business</span>
          </h1>
          <p className="max-w-[620px] text-base leading-7 text-[#8c9dac] sm:text-lg sm:leading-[30px]">
          Projects, people, clients, time, finance, and AI—all connected in one
            <br className="hidden md:block" /> platform. No separate apps, no unnecessary complexity, and no hidden fees.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <p className="text-center text-sm font-semibold uppercase text-[#2563eb] sm:text-base">
            Built for every team &amp; workflow:
          </p>
          <ul className="flex max-w-[560px] flex-wrap justify-center gap-3 sm:gap-x-4 lg:max-w-[833px] lg:px-[74px]">
            {INDUSTRIES.map((industry) => (
              <li
                key={industry}
                className="rounded-full border-[1.5px] border-[#e5eeff] bg-[#eff4ff] px-3.5 py-2 text-[13px] font-semibold leading-5 text-[#0b1c30] sm:px-[17.5px] sm:py-[10px] sm:text-base"
              >
                {industry}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// Anchored to the end of "Entire" so it tracks the headline instead of the column.
// Arrow ink sits 62px right of the word and 51px below its cap top; the staggered
// text sits under the arrow tip, with a soft blue glow behind it.
function HeroAnnotation() {
  return (
    <span aria-hidden className="pointer-events-none absolute left-full top-0 hidden select-none xl:block">
      <span className="absolute left-[30px] top-[-102px] -z-10 block h-[600px] w-[600px] bg-[radial-gradient(circle_closest-side,rgba(121,152,212,0.38)_0%,rgba(121,152,212,0.3)_33%,rgba(121,152,212,0.1)_66%,rgba(121,152,212,0)_100%)]" />
      <img
        src="/pricing/hero-annotation-arrow.svg"
        alt=""
        width={64}
        height={40}
        className="absolute left-[53px] top-[65px] max-w-none rotate-6"
      />
      <span className="absolute left-[39px] top-[128px] flex rotate-6 flex-col items-start whitespace-nowrap font-['Caveat'] text-[36px] font-bold leading-[45px] tracking-[0.6px] text-[#2563eb]">
        <span className="pl-[62px]">Build</span>
        <span className="pl-[39px]">Manage</span>
        <span>Grow Together</span>
      </span>
    </span>
  );
}
