import { Headset, ShieldCheck, UserPlus, Zap, type LucideIcon } from "lucide-react";

type Benefit = {
  icon: LucideIcon;
  tag: string;
  title: string;
  body: string;
  footer: string;
};

const BENEFITS: Benefit[] = [
  {
    icon: UserPlus,
    tag: "Zero Seat Cost",
    title: "Clients are always free",
    body: "Invite unlimited clients, guests, and stakeholders to review work, collaborate, and approve deliverables without additional seat costs.",
    footer: "Unlimited client portal access",
  },
  {
    icon: ShieldCheck,
    tag: "Total Freedom",
    title: "No long-term contracts",
    body: "Start, change, upgrade, or cancel your aaso plan whenever your business needs change—with flexible pricing that keeps you in control.",
    footer: "Upgrade or cancel anytime",
  },
  {
    icon: Headset,
    tag: "Dedicated Humans",
    title: "24/7 Priority support",
    body: "Get direct assistance for your account, workflows, and platform questions so your team can keep projects moving without unnecessary delays.",
    footer: "Fast, dedicated support",
  },
  {
    icon: Zap,
    tag: "Unified Stack",
    title: "Everything connected in one platform",
    body: "Bring project management, client collaboration, time tracking, HR, finance, invoicing, and AI capabilities together in one connected workspace.",
    footer: "One platform. Fewer disconnected tools",
  },
];

export function PricingBenefits() {
  return (
    <section className="px-4 py-10 sm:px-6 sm:py-[60px] lg:px-8">
      <ul className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-4">
        {BENEFITS.map(({ icon: Icon, tag, title, body, footer }) => (
          <li
            key={tag}
            className="flex flex-col justify-between rounded-[24px] border-[1.5px] border-[#e5eeff] bg-white p-6 drop-shadow-[0px_1.5px_1.5px_rgba(0,0,0,0.05)] sm:p-[31.5px] xl:p-6 2xl:p-[31.5px]"
          >
            <div className="flex flex-col gap-[7.5px]">
              <div className="flex items-center justify-between gap-3">
                <span className="flex size-[54px] shrink-0 items-center justify-center rounded-[12px] bg-[rgba(37,99,235,0.1)] text-[#2563eb]">
                  <Icon size={20} strokeWidth={2} aria-hidden />
                </span>
                <span className="rounded-[18px] bg-[rgba(37,99,235,0.2)] px-3 py-1.5 font-['Plus_Jakarta_Sans'] text-sm font-medium whitespace-nowrap text-black">
                  {tag}
                </span>
              </div>
              <h3 className="pt-[10.5px] font-['Inter'] text-xl font-medium text-[#0b1c30]">{title}</h3>
              <p className="text-base leading-6 text-[#434655]">{body}</p>
            </div>
            <p className="mt-6 border-t-[1.5px] border-[#e5eeff] pt-[19.5px] text-sm font-semibold text-[#2563eb]">
              {footer}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
