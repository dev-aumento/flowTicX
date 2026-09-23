import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatInWorkZone, formatWorkZoneDate, formatWorkZoneTime } from "@/lib/timezone"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getAvatarColor(name: string): string {
  const colors = [
    "#2563EB", "#3B82F6", "#10B981", "#F59E0B",
    "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatDurationClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatElapsedHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** When the time entry started — day + clock time for the log list (IST). */
export function formatTimeEntryLogged(
  clockIn: Date | string,
  clockOut?: Date | string | null,
) {
  const datePart = formatWorkZoneDate(clockIn, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = formatWorkZoneTime(clockIn, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (!clockOut) return `${datePart} · ${startTime}`;
  const endTime = formatWorkZoneTime(clockOut, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} · ${startTime} – ${endTime}`;
}

export function getTimeEntrySeconds(entry: {
  clockIn?: Date | string | null;
  clockOut?: Date | string | null;
  duration?: number | null;
  durationSeconds?: number;
}) {
  if (entry.durationSeconds != null) return entry.durationSeconds;
  if (entry.clockIn && entry.clockOut) {
    return Math.max(
      0,
      Math.floor((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 1000),
    );
  }
  return (entry.duration ?? 0) * 60;
}

export function formatTimeAgo(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatInWorkZone(then, { month: "short", day: "numeric" });
}

/** Task chat timestamps: "just now" for the first minute, then wall-clock time. */
export function formatChatTimestamp(date: Date | string, nowMs = Date.now()): string {
  const then = new Date(date);
  if (Number.isNaN(then.getTime())) return "";

  const seconds = Math.floor((nowMs - then.getTime()) / 1000);
  if (seconds < 60) return "just now";

  return formatWorkZoneTime(then, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export const statusConfig = {
  todo: { label: "Not started", color: "#6B7280", bg: "#F3F4F6", dot: "bg-gray-400" },
  in_progress: { label: "In Progress", color: "#2563EB", bg: "#DBEAFE", dot: "bg-blue-500" },
  review: { label: "Pause", color: "#D97706", bg: "#FEF3C7", dot: "bg-amber-500" },
  done: { label: "Complete", color: "#059669", bg: "#D1FAE5", dot: "bg-emerald-500" },
} as const;

export const priorityConfig = {
  low: { label: "Low", color: "#2563EB", bg: "#DBEAFE" },
  medium: { label: "Medium", color: "#D97706", bg: "#FEF3C7" },
  high: { label: "High", color: "#1D4ED8", bg: "#EFF6FF" },
  urgent: { label: "Urgent", color: "#2563EB", bg: "#EFF6FF" },
} as const;

export const roleConfig = {
  admin: { label: "Admin", color: "#2563EB", bg: "#EFF6FF" },
  manager: { label: "Manager", color: "#2563EB", bg: "#DBEAFE" },
  employee: { label: "Employee", color: "#059669", bg: "#D1FAE5" },
  hr: { label: "HR", color: "#7C3AED", bg: "#F5F3FF" },
  client: { label: "Client", color: "#0D9488", bg: "#CCFBF1" },
  finance: { label: "Account Manager", color: "#B45309", bg: "#FEF3C7" },
  platform: { label: "Master Admin", color: "#2563EB", bg: "#EFF6FF" },
} as const;
