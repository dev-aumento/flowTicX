import { cn } from "@/lib/utils";
import type { HolidayVisual } from "@/lib/holiday-icons";

/** Compact India flag (saffron / white / green + Ashoka Chakra). */
function IndiaFlagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 3 2"
      className={cn("shrink-0 rounded-[1px] shadow-sm ring-1 ring-black/10", className)}
      aria-hidden
    >
      <rect width="3" height="2" fill="#fff" />
      <rect width="3" height="0.6667" y="0" fill="#FF9933" />
      <rect width="3" height="0.6667" y="1.3333" fill="#138808" />
      <circle cx="1.5" cy="1" r="0.28" fill="none" stroke="#000080" strokeWidth="0.06" />
      {/* Simple 24-spoke suggestion */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        const x2 = 1.5 + Math.cos(a) * 0.28;
        const y2 = 1 + Math.sin(a) * 0.28;
        return (
          <line
            key={i}
            x1="1.5"
            y1="1"
            x2={x2}
            y2={y2}
            stroke="#000080"
            strokeWidth="0.04"
          />
        );
      })}
      <circle cx="1.5" cy="1" r="0.05" fill="#000080" />
    </svg>
  );
}

type Props = {
  visual: Pick<HolidayVisual, "emoji" | "flag" | "label">;
  className?: string;
  /** Flag size classes (emoji uses text size from className). */
  flagClassName?: string;
};

/** Renders holiday emoji, or a real India flag image when `flag: "in"`. */
export function HolidayVisualBadge({ visual, className, flagClassName }: Props) {
  if (visual.flag === "in") {
    return (
      <IndiaFlagIcon
        className={cn("h-3.5 w-[21px]", flagClassName, className)}
      />
    );
  }
  return (
    <span className={cn("leading-none", className)} title={visual.label} aria-hidden>
      {visual.emoji}
    </span>
  );
}
