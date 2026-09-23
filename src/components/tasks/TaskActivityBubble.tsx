import { formatWorkZoneTime } from "@/lib/timezone";

type TaskActivityBubbleProps = {
  name?: string | null;
  message: string;
  createdAt: Date | string;
};

function formatActivityClock(date: Date | string) {
  return formatWorkZoneTime(date, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();
}

/** System activity log — left-aligned compact card, not a comment bubble. */
export function TaskActivityBubble({
  name,
  message,
  createdAt,
}: TaskActivityBubbleProps) {
  return (
    <div className="max-w-[min(92%,28rem)] mr-auto">
      <div className="relative rounded-2xl bg-white/70 dark:bg-[#1a2336] border border-blue-100/80 dark:border-[#2d3a4f] px-3.5 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="text-left text-[13px] leading-relaxed text-[#374151] dark:text-gray-200 pr-12">
          <span className="inline-flex items-center rounded-md bg-[#FDE9C8] px-1.5 py-0.5 text-[13px] font-medium text-[#7A4B12] mr-1.5 align-baseline">
            {name?.trim() || "System"}
          </span>
          <span>{message}</span>
        </p>
        <span className="absolute right-3 bottom-2 text-[11px] text-gray-400 dark:text-gray-400 tabular-nums">
          {formatActivityClock(createdAt)}
        </span>
      </div>
    </div>
  );
}
