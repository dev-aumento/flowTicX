import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const EDGE_ZONE_PX = 80;
const MAX_SPEED = 16;

interface EdgeScrollAreaProps {
  children: ReactNode;
  className?: string;
  /** Show a visible horizontal scrollbar at the bottom. */
  showScrollbar?: boolean;
}

export function EdgeScrollArea({
  children,
  className = "",
  showScrollbar = false,
}: EdgeScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef(0);

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      const el = scrollRef.current;
      const dir = directionRef.current;
      if (el && dir !== 0) {
        el.scrollLeft += dir * MAX_SPEED;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const updateDirection = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const width = rect.width;

    if (width <= 0 || el.scrollWidth <= el.clientWidth) {
      directionRef.current = 0;
      return;
    }

    if (x < EDGE_ZONE_PX) {
      const intensity = 1 - Math.max(0, x) / EDGE_ZONE_PX;
      directionRef.current = -intensity;
      return;
    }

    if (x > width - EDGE_ZONE_PX) {
      const intensity = 1 - Math.max(0, width - x) / EDGE_ZONE_PX;
      directionRef.current = intensity;
      return;
    }

    directionRef.current = 0;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      updateDirection(e.clientX);
    },
    [updateDirection],
  );

  const handleMouseLeave = useCallback(() => {
    directionRef.current = 0;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      updateDirection(e.clientX);
    },
    [updateDirection],
  );

  const handleDragLeave = useCallback(() => {
    directionRef.current = 0;
  }, []);

  return (
    <div
      ref={scrollRef}
      className={cn(
        "w-full",
        showScrollbar ? "funnel-h-scroll-bar" : "funnel-h-scroll",
        className,
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDragLeave}
    >
      {children}
    </div>
  );
}
