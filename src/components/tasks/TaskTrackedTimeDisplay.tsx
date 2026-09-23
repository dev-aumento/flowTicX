import { Clock } from "lucide-react";
import { useTaskLiveTimer } from "@/hooks/useTaskLiveTimer";
import { formatElapsedHMS, cn } from "@/lib/utils";

export type TaskTimerSource = {
  startedAt?: Date | string | null;
  paused?: boolean | null;
  accumulatedSeconds?: number | null;
};

type TaskTrackedTimeDisplayProps = {
  /**
   * Seconds already logged on completed entries.
   * Live session seconds are added on top when `timerSource` has an active session.
   */
  completedSeconds?: number;
  /** Active timer snapshot — ticks locally so the parent panel does not re-render every second. */
  timerSource?: TaskTimerSource | null;
  /** When true, show only the current session elapsed (not completed + session). */
  sessionOnly?: boolean;
  className?: string;
};

/**
 * Live clock for task time tracking.
 * Owns the 1s tick so selecting/copying title or comments is not wiped by panel re-renders.
 */
export function TaskTrackedTimeDisplay({
  completedSeconds = 0,
  timerSource = null,
  sessionOnly = false,
  className,
}: TaskTrackedTimeDisplayProps) {
  const {
    elapsedSeconds,
    isRunning: isTimerRunning,
    isPaused: isTimerPaused,
    hasActiveSession,
  } = useTaskLiveTimer(timerSource);

  const trackedSeconds = sessionOnly
    ? elapsedSeconds
    : completedSeconds + (hasActiveSession ? elapsedSeconds : 0);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums",
        isTimerRunning ? "text-[#2563EB]" : "text-[#1F2937]",
        className,
      )}
    >
      <Clock
        size={14}
        className={isTimerRunning ? "text-[#2563EB] animate-pulse" : "text-gray-400"}
      />
      {formatElapsedHMS(trackedSeconds)}
      {isTimerRunning && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#2563EB] bg-blue-50 px-1.5 py-0.5 rounded font-sans">
          Live
        </span>
      )}
      {isTimerPaused && hasActiveSession && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-sans">
          Paused
        </span>
      )}
    </span>
  );
}

/** Plain mono elapsed for the current session (ticks locally). */
export function LiveSessionElapsed({
  timerSource,
  className,
}: {
  timerSource?: TaskTimerSource | null;
  className?: string;
}) {
  const { elapsedSeconds, isRunning } = useTaskLiveTimer(timerSource);
  return (
    <span
      className={cn(
        "font-mono font-semibold tabular-nums",
        isRunning ? "text-[#2563EB]" : "text-gray-700",
        className,
      )}
    >
      {formatElapsedHMS(elapsedSeconds)}
    </span>
  );
}

/** Estimate label that can turn red when live tracked time exceeds the estimate. */
export function LiveEstimateLabel({
  estimatedHours,
  completedSeconds,
  timerSource,
  formatLabel,
  isOver,
}: {
  estimatedHours: number | null | undefined;
  completedSeconds: number;
  timerSource?: TaskTimerSource | null;
  formatLabel: (hours: number | null | undefined) => string | null;
  isOver: (trackedSeconds: number, hours: number | null | undefined) => boolean;
}) {
  const { elapsedSeconds, hasActiveSession } = useTaskLiveTimer(timerSource);
  const trackedSeconds = completedSeconds + (hasActiveSession ? elapsedSeconds : 0);
  const estimateLabel = formatLabel(estimatedHours);
  if (!estimateLabel) {
    return <span className="text-sm text-gray-400 italic">Not set</span>;
  }
  const overEstimate = isOver(trackedSeconds, estimatedHours);
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono font-semibold tabular-nums text-sm",
        overEstimate ? "text-red-600" : "text-[#1F2937]",
      )}
    >
      {estimateLabel}
    </span>
  );
}
