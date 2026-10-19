import {
  BarChart3,
  Clock,
  LayoutGrid,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { AASO_SITE_URL, BrandLogo } from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils";

const features = [
  { label: "Projects", icon: LayoutGrid, className: "bg-[#5B4DDB]" },
  { label: "People", icon: Users, className: "bg-[#14B87A]" },
  { label: "Clients", icon: UserRound, className: "bg-[#3B82F6]" },
  { label: "Time", icon: Clock, className: "bg-[#F59E0B]" },
  { label: "Finance", icon: BarChart3, className: "bg-[#F43F5E]" },
  { label: "AI", icon: Sparkles, className: "bg-[#7C3AED]" },
] as const;

const stats = [
  { value: "500+", label: "Projects Delivered" },
  { value: "100+", label: "Happy Clients" },
  { value: "40+", label: "Team Members" },
  { value: "10+", label: "Years of Experience" },
] as const;

export function LoginShowcase() {
  return (
    <aside className="relative hidden h-full overflow-y-auto bg-[#071633] text-white lg:flex lg:flex-col">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle at 78% 18%, rgba(59,130,246,0.35) 0%, transparent 36%),
            radial-gradient(circle at 12% 88%, rgba(37,99,235,0.28) 0%, transparent 42%),
            radial-gradient(circle at 50% 60%, rgba(14,165,233,0.12) 0%, transparent 50%)
          `,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-8 py-5 xl:px-10 xl:py-6">
        <div className="flex shrink-0 items-start justify-between gap-6">
          <div className="min-w-0">
            <BrandLogo variant="dark" imgClassName="h-9" href={AASO_SITE_URL} />
            <p className="mt-2 max-w-[240px] text-[11px] leading-snug text-white/65">
              The Operating System for Service Businesses
            </p>
          </div>
          <p className="max-w-[190px] text-right text-[11px] leading-snug text-white/65 xl:max-w-[220px] xl:text-xs">
            Trusted by modern agencies and service teams worldwide.
          </p>
        </div>

        <div className="relative z-20 mt-4 shrink-0 xl:mt-5">
          <h2 className="max-w-xl text-[2rem] font-semibold leading-[1.08] tracking-tight xl:text-[2.7rem]">
            Everything your
            <br />
            business needs.
            <br />
            <span className="text-[#4C8DFF]">Connected.</span>
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
            Manage projects, people, clients, time, finances and grow your business from one
            powerful workspace.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <span
                  key={feature.label}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90 ring-1 ring-white/10"
                >
                  <span
                    className={cn(
                      "grid h-4 w-4 place-items-center rounded-full text-white",
                      feature.className,
                    )}
                  >
                    <Icon size={10} strokeWidth={2.4} />
                  </span>
                  {feature.label}
                </span>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex min-h-0 w-full flex-1 items-end justify-center overflow-hidden">
          <ProductPreview />
        </div>

        <div className="mt-3 grid shrink-0 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="text-xl font-semibold tracking-tight xl:text-2xl">{stat.value}</div>
              <div className="mt-0.5 text-[11px] text-white/55">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ProductPreview() {
  return (
    <img
      src="/desktop-dashboard.png"
      alt=""
      className="block h-auto max-h-full w-full object-contain object-bottom"
    />
  );
}   
