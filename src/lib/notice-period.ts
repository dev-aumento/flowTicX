import { endOfWorkZoneDay, startOfWorkZoneDay } from "@/lib/timezone";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Last moment of the Nth notice day, counting today as day 1 (workspace timezone). */
export function noticePeriodEndsAt(days: number, from: Date = new Date()): Date {
  const start = startOfWorkZoneDay(from);
  const lastDay = new Date(start.getTime() + (days - 1) * DAY_MS);
  return endOfWorkZoneDay(lastDay);
}
