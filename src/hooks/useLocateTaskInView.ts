import { useCallback, useEffect, useState } from "react";

const HIGHLIGHT_MS = 2800;
const LOCATE_ATTR = "data-task-locate-id";

export function scrollToLocatedTask(taskId: number) {
  const el = document.querySelector(`[${LOCATE_ATTR}="${taskId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  return true;
}

export function useLocateTaskInView(resetKeys: unknown[] = []) {
  const [highlightedTaskId, setHighlightedTaskId] = useState<number | null>(null);

  const locateTask = useCallback((taskId: number) => {
    setHighlightedTaskId(taskId);
  }, []);

  const clearHighlight = useCallback(() => {
    setHighlightedTaskId(null);
  }, []);

  useEffect(() => {
    if (highlightedTaskId == null) return;

    let attempts = 0;
    let scrollTimer: number | undefined;
    let retryTimer: number | undefined;

    const tryScroll = () => {
      if (scrollToLocatedTask(highlightedTaskId)) return;
      if (attempts < 6) {
        attempts += 1;
        retryTimer = window.setTimeout(tryScroll, 100);
      }
    };

    scrollTimer = window.setTimeout(tryScroll, 50);
    const clearTimer = window.setTimeout(() => setHighlightedTaskId(null), HIGHLIGHT_MS);

    return () => {
      if (scrollTimer != null) window.clearTimeout(scrollTimer);
      if (retryTimer != null) window.clearTimeout(retryTimer);
      window.clearTimeout(clearTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when view/filters change while locating
  }, [highlightedTaskId, ...resetKeys]);

  return { highlightedTaskId, locateTask, clearHighlight };
}

export const taskLocateAttr = LOCATE_ATTR;

export const taskLocateHighlightClass =
  "ring-2 ring-[#2563EB] ring-offset-2 bg-blue-50/90 shadow-md";
