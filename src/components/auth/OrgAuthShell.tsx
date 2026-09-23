import type { ReactNode } from "react";
import { Workspace } from "@contracts/constants";
import { BrandLogo } from "@/components/brand/BrandLogo";

type OrgAuthShellProps = {
  children: ReactNode;
  organizationLabel?: string;
};

export function OrgAuthShell({ children, organizationLabel }: OrgAuthShellProps) {
  const orgDisplay = organizationLabel ?? (typeof window !== "undefined" ? "Aaso" : Workspace.name);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Branding panel */}
      <div className="relative hidden lg:flex lg:w-[52%] flex-col justify-between overflow-hidden bg-[#0b1a2e] p-12 text-white">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: `
              radial-gradient(circle at 20% 80%, rgba(37, 99, 235, 0.45) 0%, transparent 45%),
              radial-gradient(circle at 80% 20%, rgba(226, 53, 45, 0.25) 0%, transparent 40%),
              radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15) 0%, transparent 60%)
            `,
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}/>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-[#060f1a] to-transparent" />

        <div className="relative z-10">
          <BrandLogo variant="dark" imgClassName="h-10" />
          <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/50">
            Powered by <span className="text-[#38BDF8]">Aumento Infoway</span>
          </p>
        </div>

        <div className="relative z-10 max-w-md">
          <p className="text-3xl font-semibold leading-snug tracking-tight">
            {Workspace.tagline}
          </p>
          <p className="mt-4 text-sm text-white/60 leading-relaxed">
            Track tasks, manage projects, and collaborate with your team — all in one place.
          </p>
        </div>

        <div className="relative z-10 text-xs text-white/40">
          © {new Date().getFullYear()} {Workspace.name}
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col min-h-screen bg-[#e8ecf1]">
        <div className="lg:hidden flex items-center px-6 py-4 bg-[#0b1a2e] text-white">
          <BrandLogo variant="dark" imgClassName="h-8" />
        </div>

        <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-[0_8px_40px_rgba(15,23,42,0.12)] px-8 py-10 sm:px-10 sm:py-12">
            <div className="text-center mb-8">
              <div className="mb-5 flex justify-center">
                <BrandLogo variant="light" imgClassName="h-9" />
              </div>
              {orgDisplay.trim() && orgDisplay.trim() !== Workspace.name ? (
                <>
                  <p className="text-[15px] text-gray-500 mb-1">Join us on</p>
                  <p className="text-xl font-bold text-gray-900 break-all">{orgDisplay}</p>
                </>
              ) : null}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
