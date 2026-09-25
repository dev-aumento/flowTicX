import { cn } from "@/lib/utils";

type BrandLogoProps = {
  /** `dark` = white wordmark on dark backgrounds. `light` = dark wordmark. `auto` follows theme. */
  variant?: "auto" | "light" | "dark";
  /** Icon-only mark for collapsed sidebars. */
  mark?: boolean;
  className?: string;
  imgClassName?: string;
};

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
}: BrandLogoProps) {
  if (mark) {
    return (
      <img
        src="/aaso-favicon.png"
        alt="Aaso"
        className={cn("h-8 w-8 object-contain flex-shrink-0", imgClassName, className)}
      />
    );
  }

  const imgClass = cn(WORDMARK_CLASS, imgClassName);

  if (variant === "dark") {
    return (
      <img
        src="/aaso-logo.png"
        alt="Aaso"
        className={cn(imgClass, className)}
      />
    );
  }

  if (variant === "light") {
    return <LightWordmark className={className} imgClassName={imgClassName} />;
  }

  return (
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
  );
}
