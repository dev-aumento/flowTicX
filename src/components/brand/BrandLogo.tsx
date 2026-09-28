import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const AASO_SITE_URL = "https://aaso.tech";

type BrandLogoProps = {
  /** `dark` = white wordmark on dark backgrounds. `light` = dark wordmark. `auto` follows theme. */
  variant?: "auto" | "light" | "dark";
  /** Icon-only mark for collapsed sidebars. */
  mark?: boolean;
  className?: string;
  imgClassName?: string;
  /** Public site link. Login screens use this so the logo opens aaso.tech. */
  href?: string;
};

function LogoLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return children;
  return (
    <a href={href} className="inline-flex min-w-0 max-w-full items-center">
      {children}
    </a>
  );
}

const WORDMARK_CLASS = "h-8 w-auto max-w-full object-contain object-left";

function LightWordmark({ className, imgClassName }: { className?: string; imgClassName?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <img
        src="/aaso-favicon.png"
        alt=""
        className={cn("h-8 w-8 flex-shrink-0 object-contain", imgClassName)}
      />
      <span className="font-serif text-[2rem] font-semibold leading-none tracking-tight text-[#111827]">
        aaso
      </span>
    </span> 
  );
}

export function BrandLogo({
  variant = "auto",
  mark = false,
  className,
  imgClassName,
  href,
}: BrandLogoProps) {
  if (mark) {
    return (
      <LogoLink href={href}>
        <img
          src="/aaso-favicon.png"
          alt="Aaso"
          className={cn("h-8 w-8 object-contain flex-shrink-0", imgClassName, className)}
        />
      </LogoLink>
    );
  }

  const imgClass = cn(WORDMARK_CLASS, imgClassName);

  if (variant === "dark") {
    return (
      <LogoLink href={href}>
        <img
          src="/aaso-logo.png"
          alt="Aaso"
          className={cn(imgClass, className)}
        />
      </LogoLink>
    );
  }

  if (variant === "light") {
    return (
      <LogoLink href={href}>
        <LightWordmark className={className} imgClassName={imgClassName} />
      </LogoLink>
    );
  }

  return (
    <LogoLink href={href}>
      <span className={cn("inline-flex min-w-0", className)}>
        <span className="dark:hidden">
          <LightWordmark imgClassName={imgClassName} />
        </span>
        <img
          src="/aaso-logo.png"
          alt="Aaso"
          className={cn(imgClass, "hidden dark:block")}
        />
      </span>
    </LogoLink>
  );
}
