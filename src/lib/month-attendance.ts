import {
  REQUIRED_DAILY_HOURS,
  REQUIRED_HALF_DAY_HOURS,
  filterMeaningfulAttendanceEntries,
  isWorkdayDateKey,
  localDateKey,
  resolveAttendanceDisplaySeconds,
  roundHours,
} from "@/lib/work-hours-policy";
import {
  eachLeaveDateKey,
  isHalfDayLeave,
  isWorkFromHomeLeave,
  isWeekdayDateKey,
  leaveTypeLabel,
} from "@/lib/leave-policy";
import {
  workZoneDateParts,
  workZoneWallTimeToUtc,
  formatInWorkZone,
} from "@/lib/timezone";

/** Official late threshold: clock-in after 10:30 IST counts as late. */
export const ATTENDANCE_START_HOUR = 10;
export const ATTENDANCE_START_MINUTE = 30;

export type DayWorkSnapshot = {
  dateKey: string;
  workedSeconds: number;
  /** Earliest clock-in ISO/Date for the day, if any. */
  firstClockIn?: Date | string | null;
  leaveCoverage?: "full" | "half" | null;
};

export type MonthLeaveBreakdownItem = {
  id?: number;
  leaveType: string;
  label: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  /** Weekday leave units in this month (and through today when current month). */
  daysInScope: number;
};

export type MonthLeaveBreakdown = {
  paidDays: number;
  sickDays: number;
  unpaidDays: number;
  halfDays: number;
  wfhDays: number;
  /** Sum of leave day units in scope (half = 0.5). */
  totalLeaveDays: number;
  items: MonthLeaveBreakdownItem[];
};

export type MonthAttendanceSummary = {
  year: number;
  month: number;
  monthLabel: string;
  /** Mon–Fri days in the full calendar month, excluding public holidays. */
  workingDays: number;
  /** Weekdays with any tracked work time. */
  attendanceDays: number;
  /** Attendance days where first clock-in was after 10:30 IST. */
  lateDays: number;
  /**
   * Approved paid / sick / unpaid leave weekdays (WFH excluded).
   * Matches leaveBreakdown paid+sick+unpaid, including weekday public holidays.
   */
  absentDays: number;
  /** Weekdays with approved half-day leave. */
  halfDays: number;
  /** Sum of all tracked attendance seconds in the calendar month. */
  workedSeconds: number;
  workedHoursLabel: string;
  /** True when the previous workday had less than 8.5 hours. */
  shortStaffingWarning: boolean;
  /** Approved leave breakdown for the month (HR justification). */
  leaveBreakdown: MonthLeaveBreakdown;
};

export type LeaveRequestLike = {
  id?: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  status?: string;
  isHalfDay?: boolean | null;
  days?: number | null;
};

function emptyLeaveBreakdown(): MonthLeaveBreakdown {
  return {
    paidDays: 0,
    sickDays: 0,
    unpaidDays: 0,
    halfDays: 0,
    wfhDays: 0,
    totalLeaveDays: 0,
    items: [],
  };
}

/**
 * Approved leave totals for a calendar month.
 * For the current month, only days through `throughKey` are counted.
 */
export function buildMonthLeaveBreakdown(
  leaves: LeaveRequestLike[],
  year: number,
  month: number,
  throughKey?: string,
): MonthLeaveBreakdown {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const breakdown = emptyLeaveBreakdown();

  for (const leave of leaves) {
    if (leave.status && leave.status !== "approved") continue;

    const half = isHalfDayLeave(leave);
    const wfh = isWorkFromHomeLeave(leave.leaveType);
    let daysInScope = 0;

    if (half) {
      if (
        leave.startDate.startsWith(prefix) &&
        isWeekdayDateKey(leave.startDate) &&
        (!throughKey || leave.startDate <= throughKey)
      ) {
        daysInScope = 0.5;
      }
    } else {
      for (const key of eachLeaveDateKey(leave.startDate, leave.endDate)) {
        if (!key.startsWith(prefix)) continue;
        if (!isWeekdayDateKey(key)) continue;
        if (throughKey && key > throughKey) continue;
        daysInScope += 1;
      }
    }

    if (daysInScope <= 0) continue;

    const item: MonthLeaveBreakdownItem = {
      id: leave.id,
      leaveType: leave.leaveType,
      label: leaveTypeLabel(leave.leaveType, {
        isHalfDay: half,
        days: leave.days,
      }),
      startDate: leave.startDate,
      endDate: leave.endDate,
      isHalfDay: half,
      daysInScope,
    };
    breakdown.items.push(item);
    breakdown.totalLeaveDays += daysInScope;

    if (wfh) {
      breakdown.wfhDays += daysInScope;
      continue;
    }

    if (half) {
      breakdown.halfDays += daysInScope;
    }

    const type = String(leave.leaveType).toLowerCase();
    if (type === "sick") breakdown.sickDays += daysInScope;
    else if (type === "unpaid") breakdown.unpaidDays += daysInScope;
    else breakdown.paidDays += daysInScope; // paid + legacy "half"
  }

  breakdown.items.sort((a, b) => a.startDate.localeCompare(b.startDate));
  breakdown.totalLeaveDays = Math.round(breakdown.totalLeaveDays * 10) / 10;
  breakdown.paidDays = Math.round(breakdown.paidDays * 10) / 10;
  breakdown.sickDays = Math.round(breakdown.sickDays * 10) / 10;
  breakdown.unpaidDays = Math.round(breakdown.unpaidDays * 10) / 10;
  breakdown.halfDays = Math.round(breakdown.halfDays * 10) / 10;
  breakdown.wfhDays = Math.round(breakdown.wfhDays * 10) / 10;

  return breakdown;
}

export function calendarMonthBounds(year: number, month: number): {
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
} {
  const start = workZoneWallTimeToUtc(year, month, 1, 0, 0, 0, 0);
  const end = workZoneWallTimeToUtc(year, month + 1, 0, 23, 59, 59, 999);
  return {
    start,
    end,
    startKey: localDateKey(start),
    endKey: localDateKey(end),
  };
}

/** Date keys from the 1st through last day of month (or through `throughKey`). */
export function eachDateKeyInMonth(
  year: number,
  month: number,
  throughKey?: string,
): string[] {
  const { endKey } = calendarMonthBounds(year, month);
  const lastKey = throughKey && throughKey < endKey ? throughKey : endKey;
  const keys: string[] = [];
  for (let day = 1; day <= 31; day++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (key > lastKey) break;
    // Validate real calendar day
    const probe = workZoneWallTimeToUtc(year, month, day, 12, 0, 0, 0);
    const parts = workZoneDateParts(probe);
    if (parts.year !== year || parts.month !== month || parts.day !== day) break;
    keys.push(key);
  }
  return keys;
}

export function formatWorkedHoursLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  if (hours <= 0 && mins <= 0) return "0 hr 0 mins";
  if (hours <= 0) return `${mins} min${mins === 1 ? "" : "s"}`;
  return `${hours} hr ${mins} min${mins === 1 ? "" : "s"}`;
}

export function isLateClockIn(
  clockIn: Date | string,
  dateKey: string,
): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return false;
  const threshold = workZoneWallTimeToUtc(
    y,
    m,
    d,
    ATTENDANCE_START_HOUR,
    ATTENDANCE_START_MINUTE,
    0,
    0,
  );
  return new Date(clockIn).getTime() > threshold.getTime();
}

/** Count Mon–Fri days in a calendar month, excluding public holidays. */
export function countMonthWorkingDays(
  year: number,
  month: number,
  holidayDateKeys: Iterable<string> = [],
): number {
  const holidays = new Set(holidayDateKeys);
  let count = 0;
  for (const dateKey of eachDateKeyInMonth(year, month)) {
    if (!isWorkdayDateKey(dateKey)) continue;
    if (holidays.has(dateKey)) continue;
    count += 1;
  }
  return count;
}

const SHORT_DAY_SECONDS = REQUIRED_DAILY_HOURS * 3600; // 8.5 hours

export function classifyMonthAttendance(
  year: number,
  month: number,
  days: DayWorkSnapshot[],
  options?: {
    asOf?: Date;
    leaves?: LeaveRequestLike[];
    /** YYYY-MM-DD public holiday dates to exclude from working days. */
    holidayDateKeys?: string[];
  },
): MonthAttendanceSummary {
  const asOf = options?.asOf ?? new Date();
  const holidayKeys = new Set(options?.holidayDateKeys ?? []);
  const isAttendanceWorkday = (dateKey: string) =>
    isWorkdayDateKey(dateKey) && !holidayKeys.has(dateKey);

  // Always use the full calendar month (all Mon–Fri minus holidays).
  const monthDateKeys = eachDateKeyInMonth(year, month);
  const byDate = new Map(days.map((d) => [d.dateKey, d]));
  const leaveBreakdown = buildMonthLeaveBreakdown(
    options?.leaves ?? [],
    year,
    month,
  );

  const workingDays = countMonthWorkingDays(year, month, holidayKeys);

  let attendanceDays = 0;
  let lateDays = 0;
  let halfDays = 0;
  let workedSeconds = 0;

  const monthStartKey = `${year}-${String(month).padStart(2, "0")}-01`;
  const { endKey: monthEndKey } = calendarMonthBounds(year, month);
  for (const day of days) {
    if (day.dateKey < monthStartKey || day.dateKey > monthEndKey) continue;
    workedSeconds += Math.max(0, day.workedSeconds || 0);
  }

  // Same source as the employee-list "X leave" total (paid + sick + unpaid).
  // Do not skip public holidays here — leave breakdown counts weekday holidays,
  // so Absent was undercounting when a leave day fell on a holiday.
  const absentDays =
    Math.round(
      (leaveBreakdown.paidDays +
        leaveBreakdown.sickDays +
        leaveBreakdown.unpaidDays) *
        10,
    ) / 10;

  for (const dateKey of monthDateKeys) {
    const snap = byDate.get(dateKey);
    const worked = Math.max(0, snap?.workedSeconds || 0);
    const leave = snap?.leaveCoverage ?? null;

    // Half days = approved half-day leave on weekdays (including holidays).
    if (isWeekdayDateKey(dateKey) && leave === "half") {
      halfDays += 1;
    }

    // Present / late only on Mon–Fri that are not public holidays.
    if (!isAttendanceWorkday(dateKey)) continue;

    if (worked > 0) {
      attendanceDays += 1;
      if (snap?.firstClockIn && isLateClockIn(snap.firstClockIn, dateKey)) {
        lateDays += 1;
      }
    }
  }

  // Previous workday short-staffing warning
  let shortStaffingWarning = false;
  for (let offset = 1; offset <= 14; offset++) {
    const parts = workZoneDateParts(asOf);
    const key = localDateKey(
      workZoneWallTimeToUtc(parts.year, parts.month, parts.day - offset, 12),
    );
    if (!isAttendanceWorkday(key)) continue;
    const snap = byDate.get(key);
    const leave = snap?.leaveCoverage ?? null;
    if (leave === "full") break;
    const worked = Math.max(0, snap?.workedSeconds || 0);
    if (leave === "half") {
      shortStaffingWarning = worked > 0 && worked < REQUIRED_HALF_DAY_HOURS * 3600;
    } else {
      shortStaffingWarning = worked > 0 && worked < SHORT_DAY_SECONDS;
    }
    break;
  }

  const monthLabel = formatInWorkZone(
    workZoneWallTimeToUtc(year, month, 1, 12, 0, 0, 0),
    { month: "long", year: "numeric" },
  );

  return {
    year,
    month,
    monthLabel,
    workingDays,
    attendanceDays,
    lateDays,
    absentDays,
    halfDays,
    workedSeconds,
    workedHoursLabel: formatWorkedHoursLabel(workedSeconds),
    shortStaffingWarning,
    leaveBreakdown,
  };
}

export function monthLabelFromParts(year: number, month: number): string {
  return formatInWorkZone(
    workZoneWallTimeToUtc(year, month, 1, 12, 0, 0, 0),
    { month: "long", year: "numeric" },
  );
}

/** Round hours helper re-export for UI. */
export { roundHours };

type AttendanceEntryLike = {
  id?: number;
  userId: number;
  clockIn: Date | string;
  clockOut?: Date | string | null;
  durationSeconds?: number | null;
  duration?: number | null;
  taskId?: number | null;
  note?: string | null;
};

function breaksForEntry(
  allBreaks: Array<{
    userId: number;
    startTime: Date | string;
    endTime?: Date | string | null;
  }>,
  userId: number,
  clockIn: Date,
  clockOut: Date,
) {
  return allBreaks.filter((b) => {
    if (b.userId !== userId) return false;
    const bStart = new Date(b.startTime);
    if (bStart >= clockOut) return false;
    const end = b.endTime ? new Date(b.endTime) : clockOut;
    return end > clockIn;
  });
}

/** Build per-day work snapshots from attendance entries, breaks, and leave coverage. */
export function buildDaySnapshotsFromEntries(params: {
  userId: number;
  entries: AttendanceEntryLike[];
  breaks: Array<{
    userId: number;
    startTime: Date | string;
    endTime?: Date | string | null;
  }>;
  leaveByDate: Map<string, "full" | "half">;
  now?: Date;
  liveSession?: { startTime: Date | string; workSeconds: number } | null;
}): DayWorkSnapshot[] {
  const now = params.now ?? new Date();
  const byDate = new Map<
    string,
    { workedSeconds: number; firstClockIn: Date | null }
  >();

  const meaningful = filterMeaningfulAttendanceEntries(
    params.entries
      .filter(
        (e): e is AttendanceEntryLike & { id: number } =>
          e.userId === params.userId && e.taskId == null && typeof e.id === "number",
      ),
  );

  for (const entry of meaningful) {
    if (!entry.clockOut) continue;
    const clockIn = new Date(entry.clockIn);
    const clockOut = new Date(entry.clockOut);
    const dateKey = localDateKey(clockIn);
    const breaks = breaksForEntry(params.breaks, params.userId, clockIn, clockOut);
    const seconds = resolveAttendanceDisplaySeconds(entry, breaks, now);
    const row = byDate.get(dateKey) ?? { workedSeconds: 0, firstClockIn: null };
    row.workedSeconds += seconds;
    if (!row.firstClockIn || clockIn < row.firstClockIn) {
      row.firstClockIn = clockIn;
    }
    byDate.set(dateKey, row);
  }

  if (params.liveSession) {
    const sessionStart = new Date(params.liveSession.startTime);
    const dateKey = localDateKey(sessionStart);
    const row = byDate.get(dateKey) ?? { workedSeconds: 0, firstClockIn: null };
    row.workedSeconds += Math.max(0, params.liveSession.workSeconds);
    if (!row.firstClockIn || sessionStart < row.firstClockIn) {
      row.firstClockIn = sessionStart;
    }
    byDate.set(dateKey, row);
  }

  const allKeys = new Set([...byDate.keys(), ...params.leaveByDate.keys()]);

  return Array.from(allKeys)
    .sort()
    .map((dateKey) => {
      const row = byDate.get(dateKey);
      return {
        dateKey,
        workedSeconds: row?.workedSeconds ?? 0,
        firstClockIn: row?.firstClockIn ?? null,
        leaveCoverage: params.leaveByDate.get(dateKey) ?? null,
      };
    });
}
