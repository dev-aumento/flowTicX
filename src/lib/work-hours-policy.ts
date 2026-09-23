import {
  workZoneDateKey,
  workZoneDateParts,
  workZoneWallTimeToUtc,
  workZoneWeekday,
  formatInWorkZone,
  formatWorkZoneDateKey,
  startOfWorkZoneDay,
} from "@/lib/timezone";

export {
  WORK_TIMEZONE,
  WORK_TIMEZONE_OFFSET_MS,
  workZoneDateKey,
  workZoneDateParts,
  workZoneWallTimeToUtc,
} from "@/lib/timezone";

export const REQUIRED_DAILY_HOURS = 8.5;
/** Mon–Fri working days. */
export const WORKING_DAYS_PER_WEEK = 5;
/** 5 × 8.5h = 42.5h required each work week (when no leave). */
export const REQUIRED_WEEKLY_HOURS = WORKING_DAYS_PER_WEEK * REQUIRED_DAILY_HOURS;
/** Approved half leave: employee must still complete this many hours that day. */
export const REQUIRED_HALF_DAY_HOURS = 5;

export type LeaveDayCoverage = "full" | "half";
export type LeaveCoverageMap = Map<string, LeaveDayCoverage>;

/** Required work hours for a calendar date given approved leave coverage. */
export function requiredHoursForDate(
  dateKey: string,
  leaveByDate?: LeaveCoverageMap | null,
): number {
  if (!isWorkdayDateKey(dateKey)) return 0;
  const coverage = leaveByDate?.get(dateKey);
  if (coverage === "full") return 0;
  if (coverage === "half") return REQUIRED_HALF_DAY_HOURS;
  return REQUIRED_DAILY_HOURS;
}

/** Sum Mon–Fri required hours for the week containing `referenceDate`. */
export function requiredWeeklyHoursForWeek(
  referenceDate = new Date(),
  leaveByDate?: LeaveCoverageMap | null,
): number {
  const start = startOfCalendarWeek(referenceDate);
  const startParts = workZoneDateParts(start);
  let total = 0;
  for (let i = 0; i < WORKING_DAYS_PER_WEEK; i++) {
    const key = workZoneDateKey(
      workZoneWallTimeToUtc(startParts.year, startParts.month, startParts.day + i, 12),
    );
    total += requiredHoursForDate(key, leaveByDate);
  }
  return roundHours(total);
}

export type BreakdownPeriod = "week" | "month";

/** JS weekday: 0 = Sunday … 6 = Saturday. Workdays are Mon–Fri. */
export function isWorkday(date: Date | string): boolean {
  const day = workZoneWeekday(date);
  return day >= 1 && day <= 5;
}

export function isWorkdayDateKey(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return false;
  return isWorkday(workZoneWallTimeToUtc(y, m, d, 12, 0, 0));
}

/** Stored attendance duration in seconds (prefers durationSeconds over legacy minutes). */
export function attendanceEntrySeconds(entry: {
  durationSeconds?: number | null;
  duration?: number | null;
  clockIn?: Date | string;
  clockOut?: Date | string | null;
}): number {
  if (entry.durationSeconds != null) {
    return Math.max(0, entry.durationSeconds);
  }
  if (entry.duration != null) {
    return Math.max(0, entry.duration * 60);
  }
  if (entry.clockIn && entry.clockOut) {
    return Math.max(
      0,
      Math.floor(
        (new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 1000,
      ),
    );
  }
  return 0;
}

/** Monday 00:00:00.000 IST of the week containing `date`. */
export function startOfCalendarWeek(date = new Date()) {
  const { year, month, day } = workZoneDateParts(date);
  const weekday = workZoneWeekday(date);
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return workZoneWallTimeToUtc(year, month, day + diff, 0, 0, 0, 0);
}

/** Friday 23:59:59.999 IST — end of the 5-day work week. */
export function endOfWorkWeek(date = new Date()) {
  const start = startOfCalendarWeek(date);
  const { year, month, day } = workZoneDateParts(start);
  return workZoneWallTimeToUtc(year, month, day + 4, 23, 59, 59, 999);
}

/**
 * Sunday 23:59:59.999 IST of the calendar week.
 * Used so weekend clock time still rolls into the same week's totals/OT vs 42.5h.
 */
export function endOfCalendarWeek(date = new Date()) {
  const start = startOfCalendarWeek(date);
  const { year, month, day } = workZoneDateParts(start);
  return workZoneWallTimeToUtc(year, month, day + 6, 23, 59, 59, 999);
}

export function roundHours(hours: number) {
  return Math.round(hours * 10) / 10;
}

export function splitRegularAndOvertime(totalHours: number, requiredHours: number) {
  const regularHours = Math.min(totalHours, requiredHours);
  const overtimeHours = Math.max(0, totalHours - requiredHours);
  return { regularHours, overtimeHours };
}

export function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Hours and minutes only (floors seconds) — for breakdown summaries. */
export function formatHoursMinutesFloored(totalSeconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Precise worked time with seconds (no rounding up to whole minutes). */
export function formatPreciseWorkedTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatPreciseWorkedClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatHoursCompact(hours: number): string {
  return `${roundHours(hours)}h`;
}

export type DailyHoursRow = {
  date: string;
  hours: number;
  regularHours: number;
  overtimeHours: number;
  minutes: number;
  /** Expected work hours for this date (8.5, 5 on half leave, 0 on full leave). */
  requiredHours?: number;
};

/** IST calendar date key (YYYY-MM-DD). Kept name for call-site compatibility. */
export function localDateKey(date: Date | string): string {
  return workZoneDateKey(date);
}

/** Hour (0–23) when employees are auto clocked out if still working (IST). */
export const AUTO_CLOCK_OUT_HOUR = 24;

/**
 * 12:00 AM Asia/Kolkata on the session's IST calendar day.
 * If clock-in is at/after 12:00 AM IST, deadline is 12:00 AM IST the next day.
 */
export function getAutoClockOutDeadline(sessionStart: Date | string): Date {
  const start = new Date(sessionStart);
  const { year, month, day } = workZoneDateParts(start);
  const sameDayDeadline = workZoneWallTimeToUtc(
    year,
    month,
    day,
    AUTO_CLOCK_OUT_HOUR,
    0,
    0,
    0,
  );
  if (start.getTime() >= sameDayDeadline.getTime()) {
    return workZoneWallTimeToUtc(year, month, day + 1, AUTO_CLOCK_OUT_HOUR, 0, 0, 0);
  }
  return sameDayDeadline;
}

export function isPastAutoClockOutDeadline(
  sessionStart: Date | string,
  now: Date = new Date(),
): boolean {
  return now.getTime() >= getAutoClockOutDeadline(sessionStart).getTime();
}

export type BreakInterval = {
  startTime: Date | string;
  endTime?: Date | string | null;
};

/** Seconds of a break that fall inside [windowStart, windowEnd]. */
export function breakOverlapSeconds(
  breakStart: Date | string,
  breakEnd: Date | string | null | undefined,
  windowStart: Date,
  windowEnd: Date,
  now: Date = new Date(),
): number {
  const startMs = Math.max(new Date(breakStart).getTime(), windowStart.getTime());
  const rawEndMs = breakEnd ? new Date(breakEnd).getTime() : Math.min(now.getTime(), windowEnd.getTime());
  const endMs = Math.min(rawEndMs, windowEnd.getTime());
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

export function sumBreakSecondsInWindow(
  breaks: BreakInterval[],
  windowStart: Date,
  windowEnd: Date,
  now: Date = new Date(),
): number {
  return breaks.reduce(
    (sum, item) =>
      sum + breakOverlapSeconds(item.startTime, item.endTime, windowStart, windowEnd, now),
    0,
  );
}

/** Work seconds for a completed attendance span: clock-in → clock-out minus breaks. */
export function computeAttendanceWorkSeconds(
  clockIn: Date | string,
  clockOut: Date | string | null | undefined,
  breaks: BreakInterval[],
  now: Date = new Date(),
): number {
  const start = new Date(clockIn);
  const end = clockOut ? new Date(clockOut) : now;
  if (end.getTime() <= start.getTime()) return 0;

  const spanSeconds = Math.floor((end.getTime() - start.getTime()) / 1000);
  const breakSeconds = sumBreakSecondsInWindow(breaks, start, end, now);
  return Math.max(0, spanSeconds - breakSeconds);
}

/** Display duration for a completed entry: always subtract overlapping breaks. */
export function resolveAttendanceDisplaySeconds(
  entry: {
    clockIn: Date | string;
    clockOut?: Date | string | null;
    durationSeconds?: number | null;
    duration?: number | null;
  },
  breaks: BreakInterval[],
  now: Date = new Date(),
): number {
  if (!entry.clockOut) return 0;

  const clockIn = new Date(entry.clockIn);
  const clockOut = new Date(entry.clockOut);
  const spanSeconds = Math.max(
    0,
    Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000),
  );
  const computed = computeAttendanceWorkSeconds(entry.clockIn, entry.clockOut, breaks, now);
  const breakSeconds = sumBreakSecondsInWindow(breaks, clockIn, clockOut, now);

  // Breaks overlapping this entry must always reduce the shown duration.
  // Stored durationSeconds/duration often still reflect raw wall span when
  // minutes were floored (`duration * 60 < span`), which previously skipped
  // break subtraction and inflated day/session totals.
  if (breakSeconds > 0) {
    return computed;
  }

  const stored = attendanceEntrySeconds(entry);
  if (stored > 0) {
    return Math.min(stored, spanSeconds);
  }
  return computed;
}

export type AttendanceDedupeEntry = {
  id: number;
  clockIn: Date | string;
  clockOut?: Date | string | null;
  note?: string | null;
};

const DUPLICATE_CLEANUP_NOTE_RE = /Duplicate open entry closed/i;
/** Fragments shorter than this that overlap a longer span are treated as junk. */
const OVERLAP_JUNK_MAX_SPAN_MS = 60_000;

function attendanceWallSpanMs(entry: AttendanceDedupeEntry): number {
  if (!entry.clockOut) return 0;
  return Math.max(
    0,
    new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime(),
  );
}

function intervalsOverlapMs(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Drop zero-span / duplicate-cleanup junk and short overlapping fragments so
 * day/week totals are not inflated by concurrent clock-in leftovers.
 * Legitimate non-overlapping re-clocks on the same day are preserved.
 */
export function filterMeaningfulAttendanceEntries<T extends AttendanceDedupeEntry>(
  entries: T[],
): T[] {
  const open = entries.filter((e) => !e.clockOut);
  const completed = entries.filter((e) => e.clockOut);

  const candidates = completed.filter((entry) => {
    if (DUPLICATE_CLEANUP_NOTE_RE.test(entry.note ?? "")) return false;
    if (attendanceWallSpanMs(entry) <= 0) return false;
    return true;
  });

  // Prefer longer spans so short overlapping leftovers are discarded first.
  const bySpanDesc = [...candidates].sort((a, b) => {
    const spanDiff = attendanceWallSpanMs(b) - attendanceWallSpanMs(a);
    if (spanDiff !== 0) return spanDiff;
    return a.id - b.id;
  });

  const kept: T[] = [];
  for (const entry of bySpanDesc) {
    const start = new Date(entry.clockIn).getTime();
    const end = new Date(entry.clockOut!).getTime();
    const span = end - start;

    const isJunkFragment = kept.some((other) => {
      const otherStart = new Date(other.clockIn).getTime();
      const otherEnd = new Date(other.clockOut!).getTime();
      if (start >= otherStart && end <= otherEnd) return true;
      if (span > OVERLAP_JUNK_MAX_SPAN_MS) return false;
      return intervalsOverlapMs(start, end, otherStart, otherEnd) > 0;
    });

    if (!isJunkFragment) kept.push(entry);
  }

  return [...kept, ...open].sort((a, b) => {
    const timeDiff = new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id - b.id;
  });
}

export type SessionWorkState = {
  startTime?: Date | string;
  paused?: boolean;
  accumulatedWorkSeconds?: number;
  breakStartedAt?: Date | string | null;
  workSegmentStartedAt?: Date | string | null;
};

/** Work seconds excluding breaks: clock-in → pause, resume → clock-out segments. */
export function computeSessionWorkSeconds(
  state: SessionWorkState,
  now: Date = new Date(),
): number {
  const accumulated = state.accumulatedWorkSeconds ?? 0;
  const hasPauseState =
    state.workSegmentStartedAt != null ||
    !!state.paused ||
    accumulated > 0 ||
    state.breakStartedAt != null;

  if (!hasPauseState && state.startTime) {
    return Math.floor(
      (now.getTime() - new Date(state.startTime).getTime()) / 1000,
    );
  }

  let workSeconds = accumulated;
  if (state.workSegmentStartedAt) {
    workSeconds += Math.floor(
      (now.getTime() - new Date(state.workSegmentStartedAt).getTime()) / 1000,
    );
  }
  return workSeconds;
}

export function isDateInCalendarWeek(dateStr: string, referenceDate = new Date()) {
  const start = localDateKey(startOfCalendarWeek(referenceDate));
  const end = localDateKey(endOfCalendarWeek(referenceDate));
  return dateStr >= start && dateStr <= end;
}

/** Replace server snapshot of active session work with live tick for display. */
export function adjustHoursForLiveSession(
  totalHours: number,
  activeSession: { workSeconds: number } | null | undefined,
  liveWorkSeconds: number,
  includeActive: boolean,
) {
  return workedSecondsFromStats(
    { totalHours, activeSession },
    liveWorkSeconds,
    includeActive,
  ) / 3600;
}

export function workedSecondsFromStats(
  stats: {
    totalSeconds?: number;
    totalHours?: number;
    activeSession?: { workSeconds: number } | null;
  } | null | undefined,
  liveWorkSeconds: number,
  includeLive: boolean,
): number {
  const baseSeconds =
    stats?.totalSeconds ??
    Math.round((stats?.totalHours ?? 0) * 3600);

  if (!includeLive || !stats?.activeSession) {
    return Math.max(0, baseSeconds);
  }

  return Math.max(
    0,
    baseSeconds - stats.activeSession.workSeconds + liveWorkSeconds,
  );
}

export function periodClockInBounds(
  period: "today" | "week" | "month",
  referenceDate = new Date(),
) {
  const start = periodRangeStart(period, referenceDate);
  let end: Date;
  if (period === "today") {
    const { year, month, day } = workZoneDateParts(referenceDate);
    end = workZoneWallTimeToUtc(year, month, day, 23, 59, 59, 999);
  } else if (period === "week") {
    end = endOfCalendarWeek(referenceDate);
  } else {
    end = new Date(referenceDate);
  }
  return { start, end };
}

/** IST calendar day bounds for filtering time entries (inclusive). */
export function dayBounds(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return {
    start: workZoneWallTimeToUtc(y, m, d, 0, 0, 0, 0),
    end: workZoneWallTimeToUtc(y, m, d, 23, 59, 59, 999),
  };
}

export function periodRangeStart(
  period: "today" | "week" | "month",
  referenceDate = new Date(),
): Date {
  if (period === "today") {
    return startOfWorkZoneDay(referenceDate);
  }
  if (period === "week") {
    return startOfCalendarWeek(referenceDate);
  }
  const { year, month, day } = workZoneDateParts(referenceDate);
  return workZoneWallTimeToUtc(year, month - 1, day, 0, 0, 0, 0);
}

function emptyDay(
  dateStr: string,
  leaveByDate?: LeaveCoverageMap | null,
): DailyHoursRow {
  return {
    date: dateStr,
    hours: 0,
    regularHours: 0,
    overtimeHours: 0,
    minutes: 0,
    requiredHours: requiredHoursForDate(dateStr, leaveByDate),
  };
}

export function buildDailyBreakdown(
  dailyMinutes: Map<string, number>,
  leaveByDate?: LeaveCoverageMap | null,
): DailyHoursRow[] {
  return Array.from(dailyMinutes.entries())
    .map(([date, minutes]) => {
      const hours = minutes / 60;
      const required = requiredHoursForDate(date, leaveByDate);
      const { regularHours, overtimeHours } = splitRegularAndOvertime(hours, required);
      return {
        date,
        minutes,
        hours: roundHours(hours),
        regularHours: roundHours(regularHours),
        overtimeHours: roundHours(overtimeHours),
        requiredHours: required,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Pad sparse API rows so chart/list always match the selected period. */
export function fillBreakdownForPeriod(
  rows: DailyHoursRow[],
  period: "today" | "week" | "month",
  referenceDate = new Date(),
  leaveByDate?: LeaveCoverageMap | null,
): DailyHoursRow[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));

  if (period === "today") {
    const today = localDateKey(referenceDate);
    return [byDate.get(today) ?? emptyDay(today, leaveByDate)];
  }

  if (period === "week") {
    const start = startOfCalendarWeek(referenceDate);
    const startParts = workZoneDateParts(start);
    const result: DailyHoursRow[] = [];
    // Always show Mon–Fri (5 working days).
    for (let i = 0; i < WORKING_DAYS_PER_WEEK; i++) {
      const key = workZoneDateKey(
        workZoneWallTimeToUtc(startParts.year, startParts.month, startParts.day + i, 12),
      );
      result.push(byDate.get(key) ?? emptyDay(key, leaveByDate));
    }
    // Include Sat/Sun only when time was logged (still counts toward weekly OT).
    for (let i = WORKING_DAYS_PER_WEEK; i < 7; i++) {
      const key = workZoneDateKey(
        workZoneWallTimeToUtc(startParts.year, startParts.month, startParts.day + i, 12),
      );
      const row = byDate.get(key);
      if (row && row.hours > 0) result.push(row);
    }
    return result;
  }

  const start = periodRangeStart("month", referenceDate);
  const endKey = localDateKey(referenceDate);
  const result: DailyHoursRow[] = [];
  const startParts = workZoneDateParts(start);
  let offset = 0;
  while (true) {
    const key = workZoneDateKey(
      workZoneWallTimeToUtc(startParts.year, startParts.month, startParts.day + offset, 12),
    );
    result.push(byDate.get(key) ?? emptyDay(key, leaveByDate));
    if (key >= endKey) break;
    offset += 1;
    if (offset > 400) break;
  }
  return result;
}

/** Chart rows: month shows only days with logged time so labels align with bars. */
export function chartBreakdownForPeriod(
  rows: DailyHoursRow[],
  period: "today" | "week" | "month",
  referenceDate = new Date(),
): DailyHoursRow[] {
  const filled = fillBreakdownForPeriod(rows, period, referenceDate);
  if (period === "month") {
    return filled.filter((day) => day.hours > 0);
  }
  return filled;
}

export function listBreakdownForPeriod(
  chartRows: DailyHoursRow[],
): DailyHoursRow[] {
  return chartRows
    .filter((day) => day.hours > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function formatPeriodRangeLabel(
  period: BreakdownPeriod,
  referenceDate = new Date(),
): string {
  const fmt = (d: Date) =>
    formatInWorkZone(d, { month: "short", day: "numeric" });
  if (period === "week") {
    const start = startOfCalendarWeek(referenceDate);
    const end = endOfWorkWeek(referenceDate);
    return `Week total (${fmt(start)} – ${fmt(end)})`;
  }
  const start = periodRangeStart("month", referenceDate);
  return `Month total (${fmt(start)} – ${fmt(referenceDate)})`;
}

export function periodBreakdownSubtitle(period: BreakdownPeriod): string {
  if (period === "week") {
    return `Work week Mon–Fri · ${REQUIRED_DAILY_HOURS}h/day · ${REQUIRED_WEEKLY_HOURS}h/week`;
  }
  return "Last 30 days · scroll chart to browse each day";
}

export function formatBreakdownAxisLabel(date: string, period: BreakdownPeriod) {
  if (period === "month") {
    return formatWorkZoneDateKey(date, { month: "short", day: "numeric" });
  }
  return formatWorkZoneDateKey(date, { weekday: "short" });
}

export function buildTimeStatsSummary(
  totalMinutes: number,
  dailyMinutes: Map<string, number>,
  period: "today" | "week" | "month",
  options?: {
    leaveByDate?: LeaveCoverageMap | null;
    referenceDate?: Date;
  },
) {
  const leaveByDate = options?.leaveByDate ?? null;
  const referenceDate = options?.referenceDate ?? new Date();
  const totalHours = totalMinutes / 60;
  const dailyBreakdown = buildDailyBreakdown(dailyMinutes, leaveByDate);
  const dailyOvertimeHours = roundHours(
    dailyBreakdown.reduce((sum, day) => sum + day.overtimeHours, 0),
  );

  const todayRequired = requiredHoursForDate(localDateKey(referenceDate), leaveByDate);
  const weekRequired = requiredWeeklyHoursForWeek(referenceDate, leaveByDate);

  let requiredHours: number | null;
  let regularHours: number;
  let overtimeHours: number;

  if (period === "today") {
    requiredHours = todayRequired;
    ({ regularHours, overtimeHours } = splitRegularAndOvertime(totalHours, todayRequired));
  } else if (period === "week") {
    requiredHours = weekRequired;
    ({ regularHours, overtimeHours } = splitRegularAndOvertime(totalHours, weekRequired));
  } else {
    requiredHours = null;
    regularHours = roundHours(totalHours);
    overtimeHours = dailyOvertimeHours;
  }

  const daysWorked = dailyBreakdown.length;
  const averageHours = daysWorked > 0 ? roundHours(totalHours / daysWorked) : 0;

  return {
    totalHours: roundHours(totalHours),
    regularHours: roundHours(regularHours),
    overtimeHours: roundHours(overtimeHours),
    dailyOvertimeHours,
    requiredHours,
    requiredWeeklyHours: weekRequired,
    requiredDailyHours: todayRequired,
    averageHours,
    dailyBreakdown,
    period,
  };
}
