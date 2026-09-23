import { formatElapsedHMS } from "@/lib/utils";

export function estimatedSecondsFromHours(estimatedHours?: string | number | null): number | null {
  if (estimatedHours == null || estimatedHours === "") return null;
  const hours = parseFloat(String(estimatedHours));
  if (Number.isNaN(hours) || hours <= 0) return null;
  return Math.round(hours * 3600);
}

export function splitEstimatedHoursMinutes(estimatedHours?: string | number | null) {
  const totalSeconds = estimatedSecondsFromHours(estimatedHours);
  if (totalSeconds == null) return { hours: "", minutes: "" };
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return {
    hours: hours > 0 ? String(hours) : "",
    minutes: minutes > 0 ? String(minutes) : "",
  };
}

export function estimatedHoursFromParts(hours: string, minutes: string): number | null {
  const h = Math.max(0, parseInt(hours, 10) || 0);
  const m = Math.min(59, Math.max(0, parseInt(minutes, 10) || 0));
  if (h === 0 && m === 0) return null;
  return h + m / 60;
}

export function formatEstimatedDuration(estimatedHours?: string | number | null) {
  const seconds = estimatedSecondsFromHours(estimatedHours);
  return seconds != null ? formatElapsedHMS(seconds) : null;
}

export function isTrackedOverEstimate(
  trackedSeconds: number,
  estimatedHours?: string | number | null,
) {
  const estimateSeconds = estimatedSecondsFromHours(estimatedHours);
  return estimateSeconds != null && trackedSeconds > estimateSeconds;
}
