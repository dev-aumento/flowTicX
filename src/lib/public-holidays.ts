/** Suggested public holidays (month/day) — used as defaults when none exist yet. */
export const DEFAULT_PUBLIC_HOLIDAY_TEMPLATES: Array<{
  month: number;
  day: number;
  name: string;
}> = [
  { month: 1, day: 14, name: "Makarsankranti" },
  { month: 1, day: 15, name: "Vasi Makarsankranti" },
  { month: 1, day: 26, name: "Republic Day" },
  { month: 8, day: 15, name: "Independence Day" },
  { month: 8, day: 18, name: "Rakshabandhan" },
];

export function holidayDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function defaultHolidaysForYear(year: number): Array<{ date: string; name: string }> {
  return DEFAULT_PUBLIC_HOLIDAY_TEMPLATES.map((h) => ({
    date: holidayDateKey(year, h.month, h.day),
    name: h.name,
  }));
}

export type HolidayOccurrence = "past" | "today" | "upcoming";

/** Compare YYYY-MM-DD keys in the workspace timezone. */
export function holidayOccurrence(dateKey: string, todayKey: string): HolidayOccurrence {
  if (dateKey < todayKey) return "past";
  if (dateKey === todayKey) return "today";
  return "upcoming";
}
