import { useEffect, useState } from "react";

/** Below this width the sidebar becomes a slide-out drawer. */
export const LAYOUT_DRAWER_MAX = 1023;

/** Below this width the persistent sidebar uses compact dimensions. */
export const LAYOUT_COMPACT_MAX = 1279;

export type LayoutMode = "drawer" | "compact" | "wide";

export const SIDEBAR_WIDTH = {
  wide: { expanded: 260, collapsed: 64 },
  compact: { expanded: 220, collapsed: 56 },
  drawer: 280,
} as const;

function readLayoutMode(): LayoutMode {
  if (typeof window === "undefined") return "wide";
  const width = window.innerWidth;
  if (width <= LAYOUT_DRAWER_MAX) return "drawer";
  if (width <= LAYOUT_COMPACT_MAX) return "compact";
  return "wide";
}

export function getSidebarWidth(mode: LayoutMode, collapsed: boolean): number {
  if (mode === "drawer") return 0;
  const sizes = mode === "compact" ? SIDEBAR_WIDTH.compact : SIDEBAR_WIDTH.wide;
  return collapsed ? sizes.collapsed : sizes.expanded;
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(readLayoutMode);

  useEffect(() => {
    const onResize = () => setMode(readLayoutMode());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return mode;
}
