import { useEffect, useRef, useState } from "react";

type TaskTimerSnapshot = {
  /** When the current running segment started (wall clock). */
  startedAt?: Date | string | null;
  paused?: boolean | null;
  /** Seconds already accumulated before this running segment (usually 0 for task timers). */
  accumulatedSeconds?: number | null;
};

function toEpochMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Accurate live task timer based on wall-clock time.
 * Avoids interval drift and effect restarts from unstable Date object identities.
 */
export function useTaskLiveTimer(timer: TaskTimerSnapshot | null | undefined) {
  const startedAtMs = toEpochMs(timer?.startedAt ?? null);
  const paused = Boolean(timer?.paused);
  const accumulatedSeconds = Math.max(0, Math.floor(timer?.accumulatedSeconds ?? 0));
  const isRunning = startedAtMs != null && !paused;

  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    isRunning
      ? accumulatedSeconds + Math.max(0, Math.floor((Date.now() - startedAtMs!) / 1000))
      : accumulatedSeconds,
  );

  const anchorRef = useRef({
    startedAtMs,
    accumulatedSeconds,
    isRunning,
  });

  useEffect(() => {
    anchorRef.current = { startedAtMs, accumulatedSeconds, isRunning };

    if (!isRunning || startedAtMs == null) {
      setElapsedSeconds(accumulatedSeconds);
      return;
    }

    const tick = () => {
      const anchor = anchorRef.current;
      if (!anchor.isRunning || anchor.startedAtMs == null) {
        setElapsedSeconds(anchor.accumulatedSeconds);
        return;
      }
      const live = Math.max(
        0,
        Math.floor((Date.now() - anchor.startedAtMs) / 1000),
      );
      setElapsedSeconds(anchor.accumulatedSeconds + live);
    };

    tick();
    // Align ticks to the next whole second boundary for steadier display.
    let intervalId = 0;
    const delay = 1000 - (Date.now() % 1000);
    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, 1000);
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [startedAtMs, paused, accumulatedSeconds, isRunning]);

  return {
    elapsedSeconds,
    isRunning,
    isPaused: startedAtMs != null && paused,
    hasActiveSession: startedAtMs != null,
  };
}
