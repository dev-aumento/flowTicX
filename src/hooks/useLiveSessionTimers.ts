import { useEffect, useRef, useState } from "react";

type SessionView = {
  active: boolean | null;
  paused?: boolean;
  workElapsedSeconds?: number;
  breakElapsedSeconds?: number;
  startTime: Date | string;
};

export function useLiveSessionTimers(session: SessionView | null | undefined) {
  const [workSeconds, setWorkSeconds] = useState(0);
  const [breakSeconds, setBreakSeconds] = useState(0);
  const snapshotRef = useRef({ at: Date.now(), work: 0, break: 0, paused: false });

  useEffect(() => {
    if (!session?.active) {
      setWorkSeconds(0);
      setBreakSeconds(0);
      return;
    }

    snapshotRef.current = {
      at: Date.now(),
      work: session.workElapsedSeconds ?? 0,
      break: session.breakElapsedSeconds ?? 0,
      paused: !!session.paused,
    };

    const tick = () => {
      const elapsed = Math.floor((Date.now() - snapshotRef.current.at) / 1000);
      const { work, break: brk, paused } = snapshotRef.current;
      if (paused) {
        setWorkSeconds(work);
        setBreakSeconds(brk + elapsed);
      } else {
        setWorkSeconds(work + elapsed);
        setBreakSeconds(brk);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [
    session?.active,
    session?.paused,
    session?.workElapsedSeconds,
    session?.breakElapsedSeconds,
    session?.startTime,
  ]);

  return { workSeconds, breakSeconds };
}
