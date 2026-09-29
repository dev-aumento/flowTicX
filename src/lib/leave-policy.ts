import { REQUIRED_DAILY_HOURS } from "@/lib/work-hours-policy";
import { WORK_TIMEZONE, workZoneDateKey, workZoneDateParts } from "@/lib/timezone";

/** Fixed annual leave entitlements. */
export const MONTHLY_PAID_LEAVES = 1;
export const TOTAL_PAID_LEAVES = 12; // 1 paid leave × 12 months
export const TOTAL_SICK_LEAVES = 3;
/** Sick leave is granted in 4-month spans (1 SL per span). */
export const SICK_LEAVE_SPAN_MONTHS = 4;
export const SICK_LEAVE_PER_SPAN = 1;
/** Annual work-from-home day entitlement. */
export const TOTAL_WFH_DAYS = 20;
/** WFH is granted in 3-month spans (5 days per span). */
export const WFH_SPAN_MONTHS = 3;
export const WFH_DAYS_PER_SPAN = 5;
/** Regular employees: no paid leave for this many calendar months from probation start. */
export const PAID_LEAVE_PROBATION_MONTHS = 3;
/**
 * Interns: 3 months internship + 3 months probation — no paid leave for this many
 * calendar months from the (date-adjusted) start month.
 */
export const INTERN_PAID_LEAVE_LOCK_MONTHS = 6;
/**
 * Join before this day → unpaid/probation window starts in the joining month.
 * Join on this day or later (20–31) → window starts the following month.
 *
 * Examples (full-time, 3 locked months):
 * - Joined 19 Apr → lock Apr–Jun → PL from Jul
 * - Joined 20 Apr → lock May–Jul → PL from Aug
 * - Joined 25 Jul → lock Aug–Oct → PL from Nov
 */
export const JOIN_DAY_PROBATION_CUTOFF = 20;

export type EmploymentType = "full_time" | "intern";

export function normalizeEmploymentType(
  value?: string | null,
): EmploymentType {
  return String(value ?? "").trim().toLowerCase() === "intern" ? "intern" : "full_time";
}

/** Prefer explicit employmentType; fall back to position text containing "intern". */
export function resolveEmploymentType(user?: {
  employmentType?: string | null;
  position?: string | null;
} | null): EmploymentType {
  if (!user) return "full_time";
  if (normalizeEmploymentType(user.employmentType) === "intern") return "intern";
  const position = (user.position ?? "").trim().toLowerCase();
  if (/\bintern(?:ship)?\b/.test(position)) return "intern";
  return "full_time";
}

export function paidLeaveLockMonthCount(
  employmentType?: EmploymentType | string | null,
): number {
  return normalizeEmploymentType(employmentType) === "intern"
    ? INTERN_PAID_LEAVE_LOCK_MONTHS
    : PAID_LEAVE_PROBATION_MONTHS;
}

/**
 * Calendar Y/M/D for a joining date in Asia/Kolkata.
 * - Exact `YYYY-MM-DD` (date input) is used as-is.
 * - Any Date / ISO timestamp uses Intl in {@link WORK_TIMEZONE} (not UTC date prefix).
 */
export function joiningCalendarParts(dateOfJoining: Date | string): {
  year: number;
  month: number;
  day: number;
} {
  if (typeof dateOfJoining === "string") {
    const trimmed = dateOfJoining.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      return { year, month, day };
    }
  }

  const date =
    dateOfJoining instanceof Date ? dateOfJoining : new Date(dateOfJoining);
  if (Number.isNaN(date.getTime())) {
    return { year: 1970, month: 1, day: 1 };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WORK_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

/** Normalize any joining value to an IST `YYYY-MM-DD` key for leave calculations. */
export function toJoiningDateKey(
  dateOfJoining: Date | string | null | undefined,
): string | null {
  if (dateOfJoining == null || dateOfJoining === "") return null;
  const { year, month, day } = joiningCalendarParts(dateOfJoining);
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Calendar month index (year*12 + month0) when the no-PL window begins.
 * Joining on the 20th or later → next month; days 1–19 → joining month.
 */
export function paidLeaveLockStartMonthIndex(
  dateOfJoining: Date | string,
): number {
  const join = joiningCalendarParts(dateOfJoining);
  const joinIdx = join.year * 12 + (join.month - 1);
  // Inclusive 20th: 20 Apr → May (locks May, Jun, Jul for full-time).
  if (join.day >= JOIN_DAY_PROBATION_CUTOFF) {
    return joinIdx + 1;
  }
  return joinIdx;
}

/**
 * First month index that may unlock paid leave (exclusive end of the lock window).
 */
export function paidLeaveEligibilityStartMonthIndex(
  dateOfJoining: Date | string,
  employmentType?: EmploymentType | string | null,
): number {
  return (
    paidLeaveLockStartMonthIndex(dateOfJoining) +
    paidLeaveLockMonthCount(employmentType)
  );
}

/**
 * True while the employee is still inside the no-paid-leave window
 * (probation for full-time; internship + probation for interns).
 */
export function isInProbationPeriod(
  dateOfJoining: Date | string | null | undefined,
  asOf: Date | string = new Date(),
  employmentType?: EmploymentType | string | null,
): boolean {
  if (!dateOfJoining) return false;
  const join = joiningCalendarParts(dateOfJoining);
  const now = workZoneDateParts(asOf);
  const joinIdx = join.year * 12 + (join.month - 1);
  const nowIdx = now.year * 12 + (now.month - 1);
  const eligibilityIdx = paidLeaveEligibilityStartMonthIndex(
    dateOfJoining,
    employmentType,
  );
  return nowIdx >= joinIdx && nowIdx < eligibilityIdx;
}

/**
 * Paid leave is locked for:
 * - any month before joining, and
 * - the no-PL window starting at the date-adjusted lock month for
 *   {@link PAID_LEAVE_PROBATION_MONTHS} (or {@link INTERN_PAID_LEAVE_LOCK_MONTHS} for interns), and
 * - the current month and all future months while {@link onNoticePeriod} is true.
 *
 * Example: joined 20 Apr → lock starts May → full-time locks May–Jul → PL from Aug.
 * Example: joined 25 Jul → lock starts Aug → full-time locks Aug–Oct → PL from Nov.
 */
export function isPaidLeaveMonthLocked(
  year: number,
  month: number,
  dateOfJoining: Date | string | null | undefined,
  employmentType?: EmploymentType | string | null,
  onNoticePeriod?: boolean,
  asOf: Date | string = new Date(),
): boolean {
  if (month < 1 || month > 12) return false;
  const monthIdx = year * 12 + (month - 1);

  if (onNoticePeriod) {
    const now = workZoneDateParts(asOf);
    const nowIdx = now.year * 12 + (now.month - 1);
    if (monthIdx >= nowIdx) return true;
  }

  if (!dateOfJoining) return false;
  return monthIdx < paidLeaveEligibilityStartMonthIndex(dateOfJoining, employmentType);
}

/** Per-month PL capacity for a year (0 during lock months, else {@link MONTHLY_PAID_LEAVES}). */
export function paidLeaveMonthCapacities(
  year: number,
  dateOfJoining: Date | string | null | undefined,
  employmentType?: EmploymentType | string | null,
  onNoticePeriod?: boolean,
  asOf: Date | string = new Date(),
): number[] {
  return Array.from({ length: 12 }, (_, i) =>
    isPaidLeaveMonthLocked(year, i + 1, dateOfJoining, employmentType, onNoticePeriod, asOf)
      ? 0
      : MONTHLY_PAID_LEAVES,
  );
}

/**
 * Annual paid-leave entitlement for a calendar year.
 * Sum of eligible months (excludes months before joining and the lock window).
 * No joining date → full {@link TOTAL_PAID_LEAVES} (still reduced while on notice for current+future).
 */
export function annualPaidLeaveEntitlement(
  year: number,
  dateOfJoining: Date | string | null | undefined,
  employmentType?: EmploymentType | string | null,
  onNoticePeriod?: boolean,
  asOf: Date | string = new Date(),
): number {
  if (!dateOfJoining && !onNoticePeriod) return TOTAL_PAID_LEAVES;
  return paidLeaveMonthCapacities(
    year,
    dateOfJoining,
    employmentType,
    onNoticePeriod,
    asOf,
  ).reduce((sum, cap) => sum + cap, 0);
}

type CalendarSpan = {
  /** Inclusive start month (1–12). */
  startMonth: number;
  /** Inclusive end month (1–12). */
  endMonth: number;
  amount: number;
};

function buildYearSpans(
  spanMonths: number,
  amountPerSpan: number,
): CalendarSpan[] {
  const spans: CalendarSpan[] = [];
  for (let start = 1; start <= 12; start += spanMonths) {
    spans.push({
      startMonth: start,
      endMonth: Math.min(12, start + spanMonths - 1),
      amount: amountPerSpan,
    });
  }
  return spans;
}

/**
 * Annual entitlement from fixed calendar spans, prorated by joining month.
 * Spans that end entirely before the joining month are removed.
 * Mid-span joins still receive that span’s full allotment.
 *
 * Examples (WFH, 5 days × 3 months):
 * - Join 1 May → miss Jan–Mar → 15
 * - Join 1 Apr → keep Apr–Jun onward → 20
 *
 * Examples (sick, 1 day × 4 months):
 * - Join 1 May → miss Jan–Apr → 2
 * - Join 1 Sep → miss Jan–Aug → 1
 */
export function annualSpanEntitlement(
  year: number,
  dateOfJoining: Date | string | null | undefined,
  spanMonths: number,
  amountPerSpan: number,
  fullTotal: number,
): number {
  if (!dateOfJoining) return fullTotal;
  const join = joiningCalendarParts(dateOfJoining);
  if (!join.year || !join.month) return fullTotal;
  if (join.year > year) return 0;
  if (join.year < year) return fullTotal;

  const spans = buildYearSpans(spanMonths, amountPerSpan);
  return spans.reduce(
    (sum, span) => (span.endMonth >= join.month ? sum + span.amount : sum),
    0,
  );
}

/** Annual WFH entitlement for a calendar year (5 days per 3-month span). */
export function annualWfhEntitlement(
  year: number,
  dateOfJoining: Date | string | null | undefined,
): number {
  return annualSpanEntitlement(
    year,
    dateOfJoining,
    WFH_SPAN_MONTHS,
    WFH_DAYS_PER_SPAN,
    TOTAL_WFH_DAYS,
  );
}

/** Annual sick-leave entitlement for a calendar year (1 SL per 4-month span). */
export function annualSickLeaveEntitlement(
  year: number,
  dateOfJoining: Date | string | null | undefined,
): number {
  return annualSpanEntitlement(
    year,
    dateOfJoining,
    SICK_LEAVE_SPAN_MONTHS,
    SICK_LEAVE_PER_SPAN,
    TOTAL_SICK_LEAVES,
  );
}

/**
 * Paid leave unlocked so far in a calendar year (1 PL at the start of each eligible month).
 * Past years → unlocked months in that year. Future years → 0.
 * Current year → Jan…current month, excluding lock-window months from joining date.
 */
export function accruedPaidLeavesForYear(
  year: number,
  asOf: Date | string = new Date(),
  dateOfJoining?: Date | string | null,
  employmentType?: EmploymentType | string | null,
  onNoticePeriod?: boolean,
): number {
  const { year: asOfYear, month: asOfMonth } = workZoneDateParts(asOf);
  if (year > asOfYear) return 0;

  const lastMonth = year < asOfYear ? 12 : asOfMonth;
  let accrued = 0;
  for (let month = 1; month <= lastMonth; month += 1) {
    if (
      !isPaidLeaveMonthLocked(
        year,
        month,
        dateOfJoining ?? null,
        employmentType,
        onNoticePeriod,
        asOf,
      )
    ) {
      accrued += MONTHLY_PAID_LEAVES;
    }
  }
  return Math.min(TOTAL_PAID_LEAVES, accrued);
}

/** Short UI copy for the current no-PL window. */
export function paidLeaveLockPeriodLabel(
  employmentType?: EmploymentType | string | null,
): string {
  if (normalizeEmploymentType(employmentType) === "intern") {
    return "first 6 months (3 internship + 3 probation)";
  }
  return "first 3 months of probation";
}

/** Why a WFH request is blocked, or null when the employee may request WFH. */
export function wfhRequestBlockedMessage(
  user: {
    onNoticePeriod?: boolean | null;
    dateOfJoining?: Date | string | null;
    employmentType?: EmploymentType | string | null;
  },
  asOf: Date | string = new Date(),
  options?: { forEmployee?: boolean },
): string | null {
  const who = options?.forEmployee ? " for this employee" : "";
  if (user.onNoticePeriod) {
    return `No WFH${who} during notice period`;
  }
  if (isInProbationPeriod(user.dateOfJoining, asOf, user.employmentType)) {
    return `No WFH${who} during ${paidLeaveLockPeriodLabel(user.employmentType)}`;
  }
  return null;
}

/** Half-day leave still requires this many hours of work that day. */
export const HALF_DAY_REQUIRED_WORK_HOURS = 5;

/**
 * `"half"` is legacy (old standalone half leave); new requests use paid/sick/unpaid + isHalfDay.
 * `"wfh"` is work-from-home: no PL/SL deduction; still requires a full regular workday (8.5h).
 */
export type LeaveType = "paid" | "sick" | "unpaid" | "half" | "wfh";
export type LeaveDuration = "full" | "half";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

/** Work-from-home requests never reduce required hours and never use PL/SL. */
export function isWorkFromHomeLeave(type: LeaveType | string | null | undefined) {
  return type === "wfh";
}

/** Half-day duration is only for paid / sick / unpaid leave. */
export function allowsHalfDayLeave(type: LeaveType | string | null | undefined) {
  return type === "paid" || type === "sick" || type === "unpaid" || type === "half";
}

/** Employee may cancel pending leaves, or approved leaves that have not started yet. */
export function canCancelLeaveRequest(
  leave: { status: string; startDate: string },
  todayKey: string,
): boolean {
  if (leave.status === "pending") return true;
  if (leave.status === "approved" && leave.startDate >= todayKey) return true;
  return false;
}

/** Employee may edit pending leaves only. Approved leaves cannot be edited. */
export function canEditLeaveRequest(
  leave: { status: string; startDate: string },
  _todayKey: string,
): boolean {
  return leave.status === "pending";
}

export const LEAVE_TYPE_OPTIONS: {
  value: Exclude<LeaveType, "half">;
  label: string;
  short: string;
}[] = [
  { value: "paid", label: "Paid leave (PL)", short: "PL" },
  { value: "sick", label: "Sick leave (SL)", short: "SL" },
  { value: "unpaid", label: "Unpaid leave", short: "UL" },
  { value: "wfh", label: "Work from home (WFH)", short: "WFH" },
];

export const LEAVE_DURATION_OPTIONS: {
  value: LeaveDuration;
  label: string;
}[] = [
  { value: "full", label: "Full day" },
  { value: "half", label: "Half day" },
];

/** @deprecated Use LEAVE_DURATION_OPTIONS */
export const SICK_DURATION_OPTIONS = LEAVE_DURATION_OPTIONS;

export function isHalfDayLeave(leave: {
  leaveType?: string | null;
  isHalfDay?: boolean | null;
  days?: number | string | null;
}): boolean {
  if (leave.isHalfDay) return true;
  if (leave.leaveType === "half") return true;
  const days = Number(leave.days);
  // Tolerate string/Decimal-ish 0.5 values from storage/serialization.
  if (Number.isFinite(days) && Math.abs(days - 0.5) < 0.05) return true;
  return false;
}

/**
 * Units to deduct from PL/SL balance for a stored request.
 * Half-day paid/sick always counts as 0.5, even if `days` was stored incorrectly.
 */
export function leaveBalanceUnits(leave: {
  leaveType?: string | null;
  isHalfDay?: boolean | null;
  days?: number | null;
}): number {
  if (isHalfDayLeave(leave)) return 0.5;
  const days = leave.days ?? 0;
  return days > 0 ? days : 0;
}

/** Round leave balances to one decimal (supports 0.5 day units). */
export function roundLeaveUnits(value: number): number {
  return Math.round(value * 10) / 10;
}

export function leaveTypeLabel(
  type: LeaveType | string,
  options?: { isHalfDay?: boolean | null; days?: number | null },
) {
  if (isWorkFromHomeLeave(type)) return "Work from home (WFH)";
  const half = isHalfDayLeave({ leaveType: type, ...options });
  if (type === "half" || (type === "paid" && half)) return "Paid leave (half day)";
  if (type === "sick" && half) return "Sick leave (half day)";
  if (type === "unpaid" && half) return "Unpaid leave (half day)";
  return LEAVE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export function leaveTypeShort(type: LeaveType | string) {
  if (type === "half") return "PL";
  return LEAVE_TYPE_OPTIONS.find((o) => o.value === type)?.short ?? type;
}

export type LeaveRequestNotifyAction =
  | "new"
  | "updated"
  | "resubmitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "pending"
  | "recorded";

/** Notification title for leave / WFH requests. */
export function leaveRequestNotificationTitle(
  leaveType: LeaveType | string,
  action: LeaveRequestNotifyAction,
) {
  const wfh = isWorkFromHomeLeave(leaveType);
  switch (action) {
    case "new":
      return wfh ? "New work from home request" : "New leave request";
    case "updated":
      return wfh ? "Work from home request updated" : "Leave request updated";
    case "resubmitted":
      return wfh ? "Work from home re-submitted" : "Leave re-submitted";
    case "approved":
      return wfh ? "Work from home approved" : "Leave approved";
    case "rejected":
      return wfh ? "Work from home rejected" : "Leave rejected";
    case "cancelled":
      return wfh ? "Work from home cancelled" : "Leave cancelled";
    case "pending":
      return wfh ? "Work from home set to pending" : "Leave set to pending";
    case "recorded":
      return wfh ? "Work from home recorded" : "Leave recorded";
    default:
      return wfh ? "Work from home request" : "Leave request";
  }
}

function leaveRequestPhrase(
  leaveType: LeaveType | string,
  options?: { isHalfDay?: boolean | null; days?: number | null },
) {
  return isWorkFromHomeLeave(leaveType)
    ? "work from home request"
    : `${leaveTypeLabel(leaveType, options)} request`;
}

export function formatLeaveDateRange(startDate: string, endDate: string) {
  return startDate === endDate ? startDate : `${startDate} → ${endDate}`;
}

/** Employee notification body when HR reviews a request. */
export function employeeLeaveReviewMessage(
  leaveType: LeaveType | string,
  options: {
    status: "approved" | "rejected" | "cancelled" | "pending";
    startDate: string;
    endDate: string;
    reviewNote?: string | null;
    isHalfDay?: boolean | null;
    days?: number | null;
  },
) {
  const requestPhrase = leaveRequestPhrase(leaveType, options);
  const dateRange = formatLeaveDateRange(options.startDate, options.endDate);

  switch (options.status) {
    case "approved":
      return `Your ${requestPhrase} (${dateRange}) has been approved`;
    case "rejected":
      return `Your ${requestPhrase} was rejected${options.reviewNote ? `: ${options.reviewNote}` : ""}`;
    case "cancelled":
      return `Your ${requestPhrase} was cancelled by HR`;
    case "pending":
      return `Your ${requestPhrase} was set back to pending`;
  }
}

/** HR/manager notification body when an employee submits or changes a request. */
export function managerLeaveNotificationMessage(options: {
  actorName: string;
  leaveType: LeaveType | string;
  action: "submitted" | "updated" | "resubmitted" | "cancelled";
  days: number;
  dateLabel: string;
  isHalfDay?: boolean;
}) {
  const daysLabel = formatLeaveDays(options.days);
  const typeLabel = leaveTypeLabel(options.leaveType, {
    isHalfDay: options.isHalfDay,
    days: options.days,
  });

  if (isWorkFromHomeLeave(options.leaveType)) {
    switch (options.action) {
      case "submitted":
        return `${options.actorName} submitted a work from home request for ${daysLabel} (${options.dateLabel})`;
      case "updated":
        return `${options.actorName} updated a work from home request for ${daysLabel} (${options.dateLabel})`;
      case "resubmitted":
        return `${options.actorName} re-submitted a work from home request for ${daysLabel} (${options.dateLabel})`;
      case "cancelled":
        return `${options.actorName} cancelled a work from home request for ${daysLabel} (${options.dateLabel})`;
    }
  }

  switch (options.action) {
    case "submitted":
      return `${options.actorName} requested ${daysLabel} of ${typeLabel} (${options.dateLabel})`;
    case "updated":
      return `${options.actorName} updated ${daysLabel} of ${typeLabel} (${options.dateLabel})`;
    case "resubmitted":
      return `${options.actorName} re-submitted ${daysLabel} of ${typeLabel} (${options.dateLabel})`;
    case "cancelled":
      return `${options.actorName} cancelled ${daysLabel} of ${typeLabel} (${options.dateLabel})`;
  }
}

/** Employee notification when HR manually records leave / WFH. */
export function manualLeaveEntryMessage(
  leaveType: LeaveType | string,
  options: {
    status: "approved" | "rejected";
    days: number;
    dateLabel: string;
    isHalfDay?: boolean;
    reviewNote?: string | null;
  },
) {
  const daysLabel = formatLeaveDays(options.days);
  const typeLabel = leaveTypeLabel(leaveType, {
    isHalfDay: options.isHalfDay,
    days: options.days,
  });

  if (isWorkFromHomeLeave(leaveType)) {
    if (options.status === "approved") {
      return `HR recorded your work from home request for ${daysLabel} (${options.dateLabel})`;
    }
    return `HR recorded a rejected work from home request for ${daysLabel} (${options.dateLabel})${options.reviewNote ? ` — ${options.reviewNote}` : ""}`;
  }

  if (options.status === "approved") {
    return `HR recorded ${daysLabel} of ${typeLabel} (${options.dateLabel}) for you`;
  }
  return `HR recorded a rejected leave: ${typeLabel} (${options.dateLabel})${options.reviewNote ? ` — ${options.reviewNote}` : ""}`;
}

export function durationHint(leaveType: LeaveType | string, duration: LeaveDuration): string {
  if (isWorkFromHomeLeave(leaveType)) {
    return `Work from home counts as a regular workday. You must complete ${REQUIRED_DAILY_HOURS} hours. Does not use PL or SL.`;
  }
  if (duration === "half") {
    if (leaveType === "paid") {
      return `Half day uses 0.5 PL. You must still complete ${HALF_DAY_REQUIRED_WORK_HOURS} hours of work that day.`;
    }
    if (leaveType === "sick") {
      return `Half day uses 0.5 SL. You must still complete ${HALF_DAY_REQUIRED_WORK_HOURS} hours of work that day.`;
    }
    return `Half-day unpaid leave. You must still complete ${HALF_DAY_REQUIRED_WORK_HOURS} hours of work that day.`;
  }
  if (leaveType === "paid") return "Full day uses 1 PL and no work hours are required that day.";
  if (leaveType === "sick") return "Full day uses 1 SL and no work hours are required that day.";
  return "Full-day unpaid leave. No work hours are required that day.";
}

export function consumesPaidBalance(type: LeaveType | string) {
  return type === "paid" || type === "half";
}

export function consumesSickBalance(type: LeaveType | string) {
  return type === "sick";
}

export function entitlementForType(type: LeaveType | string) {
  if (consumesSickBalance(type)) return TOTAL_SICK_LEAVES;
  if (consumesPaidBalance(type)) return TOTAL_PAID_LEAVES;
  return Number.POSITIVE_INFINITY;
}

/**
 * Remaining paid leave for a year under monthly accrual:
 * unlocked months so far − paid days already used (approved + pending).
 */
export function remainingAccruedPaidLeave(accrued: number, paidDaysUsed: number) {
  return Math.max(0, accrued - Math.max(0, paidDaysUsed));
}

/** Remaining paid leave for a month (defaults to 1; 0 when that month’s PL is used or locked). */
export function remainingMonthlyPaidLeave(
  paidDaysUsedInMonth: number,
  monthCapacity: number = MONTHLY_PAID_LEAVES,
) {
  return Math.max(0, monthCapacity - Math.max(0, paidDaysUsedInMonth));
}

/**
 * Allocate paid-leave day units across months (Jan…Dec).
 * Each month has capacity from `monthCapacities` (defaults to 1; 0 during probation).
 * Days that fall in a month consume that month first; any excess borrows only from the
 * immediately previous month (e.g. 2 days in August → 1 from August + 1 from July).
 * Earlier months are never charged.
 *
 * @param rawDaysByMonth length-12 array, index 0 = January
 * @param monthCapacities optional length-12 capacities (defaults to {@link MONTHLY_PAID_LEAVES})
 * @returns used units per month (same shape), rounded to one decimal
 */
export function allocatePaidLeaveAcrossMonths(
  rawDaysByMonth: number[],
  monthCapacities?: number[],
): number[] {
  const used = Array.from({ length: 12 }, () => 0);
  const capacityFor = (index: number) =>
    monthCapacities?.[index] ?? MONTHLY_PAID_LEAVES;

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    let need = Math.max(0, rawDaysByMonth[monthIndex] ?? 0);
    if (need <= 0) continue;

    const spaceHere = Math.max(0, capacityFor(monthIndex) - used[monthIndex]);
    const takeHere = Math.min(need, spaceHere);
    used[monthIndex] += takeHere;
    need = roundLeaveUnits(need - takeHere);

    // Borrow only from the immediately previous month (not further back to January).
    if (need > 0 && monthIndex > 0) {
      const prev = monthIndex - 1;
      const space = Math.max(0, capacityFor(prev) - used[prev]);
      if (space > 0) {
        const take = Math.min(need, space);
        used[prev] += take;
        need = roundLeaveUnits(need - take);
      }
    }
  }

  return used.map((value) => roundLeaveUnits(value));
}

/** True for Mon–Fri (work zone calendar date key YYYY-MM-DD). Sat/Sun are off. */
export function isWeekdayDateKey(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return false;
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** Inclusive weekday count between YYYY-MM-DD keys (Sat/Sun excluded). */
export function leaveDayCount(startDate: string, endDate: string): number {
  return eachLeaveDateKey(startDate, endDate).filter(isWeekdayDateKey).length;
}

/** Day units charged against balance (half day = 0.5; weekends never count). */
export function leaveDayUnits(
  leaveType: LeaveType | string,
  startDate: string,
  endDate: string,
  isHalfDay = false,
): number {
  if (leaveType === "half" || isHalfDay) {
    if (startDate !== endDate) return 0;
    if (!isWeekdayDateKey(startDate)) return 0;
    return 0.5;
  }
  return leaveDayCount(startDate, endDate);
}

export function formatLeaveDays(days: number): string {
  if (days === 0.5) return "0.5 day";
  if (days === 1) return "1 day";
  // Keep one decimal for fractional totals like 1.5
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

/** Iterate each YYYY-MM-DD key from start through end (inclusive). */
export function eachLeaveDateKey(startDate: string, endDate: string): string[] {
  const [ys, ms, ds] = startDate.split("-").map(Number);
  const [ye, me, de] = endDate.split("-").map(Number);
  if (!ys || !ms || !ds || !ye || !me || !de) return [];
  const start = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  if (end < start) return [];

  const keys: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t);
    keys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return keys;
}

/** Weekday WFH/leave date keys that fall in a calendar year. */
export function leaveDateKeysInYear(
  startDate: string,
  endDate: string,
  year: number,
): string[] {
  const prefix = `${year}-`;
  return eachLeaveDateKey(startDate, endDate).filter(
    (key) => key.startsWith(prefix) && isWeekdayDateKey(key),
  );
}

/** Normalize leave date fields (string or Date) to YYYY-MM-DD. */
export function toLeaveDateKey(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Use work-zone calendar day so IST midnights are not shifted via UTC.
    return workZoneDateKey(value);
  }
  // Plain Date-like objects (e.g. deserialized JSON).
  if (
    typeof value === "object" &&
    value !== null &&
    "getTime" in value &&
    typeof (value as Date).getTime === "function"
  ) {
    const d = new Date((value as Date).getTime());
    if (!Number.isNaN(d.getTime())) return workZoneDateKey(d);
  }
  return null;
}

/** True when two inclusive YYYY-MM-DD ranges share any calendar day. */
export function leaveDateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const aS = toLeaveDateKey(aStart) ?? aStart;
  const aE = toLeaveDateKey(aEnd) ?? aEnd;
  const bS = toLeaveDateKey(bStart) ?? bStart;
  const bE = toLeaveDateKey(bEnd) ?? bEnd;
  return aS <= bE && aE >= bS;
}

/** First date in `startDate`–`endDate` that overlaps an existing leave range, if any. */
export function firstOverlappingLeaveDate(
  startDate: string,
  endDate: string,
  existing: { startDate: string | Date; endDate: string | Date },
): string | null {
  const rangeStart = toLeaveDateKey(startDate);
  const rangeEnd = toLeaveDateKey(endDate) ?? rangeStart;
  const existingStart = toLeaveDateKey(existing.startDate);
  const existingEnd = toLeaveDateKey(existing.endDate) ?? existingStart;
  if (!rangeStart || !rangeEnd || !existingStart || !existingEnd) return null;

  if (!leaveDateRangesOverlap(rangeStart, rangeEnd, existingStart, existingEnd)) {
    return null;
  }
  for (const key of eachLeaveDateKey(rangeStart, rangeEnd)) {
    if (key >= existingStart && key <= existingEnd) return key;
  }
  return rangeStart;
}

/** User-facing message when applying leave on a day that already has a request. */
export function alreadyAppliedLeaveMessage(_date?: string | null) {
  return "You have already applied for leave on this day.";
}

/** HR-facing message when recording leave on a day that already has leave. */
export function leaveAlreadyExistsForEmployeeMessage(_date?: string | null) {
  return "Leave for this day already exists for this employee.";
}

/** Count leave day units that fall in a given calendar month (1–12). Weekends excluded. */
export function leaveDaysInMonth(
  startDate: string,
  endDate: string,
  year: number,
  month: number,
  leaveType: LeaveType | string = "paid",
  isHalfDay = false,
): number {
  const startKey = toLeaveDateKey(startDate);
  const endKey = toLeaveDateKey(endDate) ?? startKey;
  if (!startKey || !endKey) return 0;

  if (leaveType === "half" || isHalfDay) {
    const y = Number(startKey.slice(0, 4));
    const m = Number(startKey.slice(5, 7));
    if (y !== year || m !== month) return 0;
    return isWeekdayDateKey(startKey) ? 0.5 : 0;
  }

  return eachLeaveDateKey(startKey, endKey).filter((key) => {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    return y === year && m === month && isWeekdayDateKey(key);
  }).length;
}

/**
 * True when any calendar day of the leave falls in `year`/`month` (1–12).
 * Used for month detail lists (includes weekend half-days that count 0 units).
 */
export function leaveTouchesMonth(
  startDate: string,
  endDate: string,
  year: number,
  month: number,
  leaveType: LeaveType | string = "paid",
  isHalfDay = false,
): boolean {
  const startKey = toLeaveDateKey(startDate);
  const endKey = toLeaveDateKey(endDate) ?? startKey;
  if (!startKey || !endKey) return false;

  if (leaveType === "half" || isHalfDay) {
    return (
      Number(startKey.slice(0, 4)) === year &&
      Number(startKey.slice(5, 7)) === month
    );
  }

  return eachLeaveDateKey(startKey, endKey).some(
    (key) =>
      Number(key.slice(0, 4)) === year && Number(key.slice(5, 7)) === month,
  );
}

/** Count leave day units that fall in a given calendar year. Weekends excluded. */
export function leaveDaysInYear(
  startDate: string,
  endDate: string,
  year: number,
  leaveType: LeaveType | string = "paid",
  isHalfDay = false,
): number {
  let total = 0;
  for (let month = 1; month <= 12; month++) {
    total += leaveDaysInMonth(startDate, endDate, year, month, leaveType, isHalfDay);
  }
  return roundLeaveUnits(total);
}

/** Calendar years touched by a leave date range (inclusive). */
export function leaveYearsInRange(startDate: string, endDate: string): number[] {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear < startYear) {
    return Number.isFinite(startYear) ? [startYear] : [];
  }
  const years: number[] = [];
  for (let year = startYear; year <= endYear; year++) years.push(year);
  return years;
}

/**
 * Build per-date leave coverage for work-hours calculation.
 * - full: paid / sick / unpaid → 0h required that day
 * - half: any half-day leave → 5h required that day
 * - wfh: skipped (still requires a regular 8.5h workday)
 * Full coverage wins over half if both somehow apply.
 * Weekend dates are skipped (Sat/Sun are always off).
 */
export function buildLeaveCoverageMap(
  leaves: Array<{
    leaveType: string;
    startDate: string;
    endDate: string;
    status?: string;
    isHalfDay?: boolean | null;
    days?: number | null;
  }>,
): Map<string, "full" | "half"> {
  const map = new Map<string, "full" | "half">();
  for (const leave of leaves) {
    if (leave.status && leave.status !== "approved") continue;
    // WFH is location-only — keep required hours at a normal workday (8.5h).
    if (isWorkFromHomeLeave(leave.leaveType)) continue;
    if (isHalfDayLeave(leave)) {
      if (isWeekdayDateKey(leave.startDate) && !map.has(leave.startDate)) {
        map.set(leave.startDate, "half");
      }
      continue;
    }
    for (const key of eachLeaveDateKey(leave.startDate, leave.endDate)) {
      if (!isWeekdayDateKey(key)) continue;
      map.set(key, "full");
    }
  }
  return map;
}

export function canManageLeaves(
  user: {
    role?: string | null;
    department?: string | null;
    permissions?: string[] | null;
  } | null | undefined,
): boolean {
  if (!user) return false;
  if (String(user.role ?? "").toLowerCase() === "admin") return true;
  if (isHrUser(user)) return true;
  return user.permissions?.includes("leaves.manage") === true;
}

/**
 * Attendance, office locations, and attendance QR codes.
 * Admin, HR, or anyone granted `attendance.manage`.
 */
export function canManageAttendance(
  user: {
    role?: string | null;
    department?: string | null;
    permissions?: string[] | null;
  } | null | undefined,
): boolean {
  if (!user) return false;
  if (String(user.role ?? "").toLowerCase() === "admin") return true;
  if (isHrUser(user)) return true;
  return user.permissions?.includes("attendance.manage") === true;
}

/**
 * Admin, HR, and project managers (role `manager`) may set/view the notice-period flag.
 * Also allows anyone with `employees.manage` (covers custom grants).
 */
export function canManageNoticePeriod(
  user:
    | {
        role?: string | null;
        department?: string | null;
        permissions?: string[] | null;
      }
    | null
    | undefined,
): boolean {
  if (!user) return false;
  const role = String(user.role ?? "").toLowerCase();
  if (role === "admin" || role === "manager") return true;
  if (isHrUser(user)) return true;
  return user.permissions?.includes("employees.manage") ?? false;
}

/**
 * Admins and leadership departments do not use personal clock-in / own-hours tracking.
 * Matched by system role `admin` or department Management / Administration / Administrator.
 */
export function isAdminOrManagement(
  user: { role?: string | null; department?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (String(user.role ?? "").toLowerCase() === "platform") return false;
  if (String(user.role ?? "").toLowerCase() === "admin") return true;
  const department = (user.department ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return (
    department === "management" ||
    department === "administration" ||
    department === "administrator"
  );
}

/**
 * People listed on the Attendance management page: employees, HR, and project managers.
 * Excludes admins, clients, finance, and platform accounts.
 */
export function isAttendanceTrackableUser(
  user: { role?: string | null; department?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (isAdminOrManagement(user)) return false;
  if (isFinanceUser(user)) return false;
  const role = String(user.role ?? "").toLowerCase();
  if (
    role === "admin" ||
    role === "client" ||
    role === "finance" ||
    role === "platform"
  ) {
    return false;
  }
  return role === "employee" || role === "hr" || role === "manager" || isHrUser(user);
}

/**
 * HR users do not use task/project product areas.
 * Matched by system role `hr` or department set to HR.
 */
export function isHrUser(
  user: { role?: string | null; department?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (String(user.role ?? "").toLowerCase() === "hr") return true;
  const department = (user.department ?? "").trim().toLowerCase();
  return department === "hr" || department === "human resources";
}

/** @deprecated Prefer isHrUser — kept for existing imports. */
export const isHrDepartmentUser = isHrUser;

/**
 * True only when the system role is `hr`.
 * Used for HR-exclusive UI (e.g. HR dashboard) — not shown to admins/employees.
 */
export function isHrRoleOnly(
  user: { role?: string | null } | null | undefined,
): boolean {
  return String(user?.role ?? "").toLowerCase() === "hr";
}

/** Routes HR users must not open (unless granted via permissions elsewhere). */
export function isHrRestrictedPath(path: string): boolean {
  if (path === "/tasks" || path.startsWith("/tasks/")) return true;
  if (path === "/admin/tasks" || path.startsWith("/admin/tasks/")) return true;
  if (path === "/admin/client-tasks" || path.startsWith("/admin/client-tasks")) return true;
  if (path === "/projects" || path.startsWith("/projects/")) return true;
  if (path === "/task-chats" || path.startsWith("/task-chats/")) return true;
  if (path === "/admin/permissions" || path.startsWith("/admin/permissions/")) return true;
  if (path === "/admin/manage-data" || path.startsWith("/admin/manage-data")) return true;
  if (path === "/admin/pricing" || path.startsWith("/admin/pricing")) return true;
  if (path === "/admin/invoices" || path.startsWith("/admin/invoices/")) return true;
  if (path === "/admin/customers" || path.startsWith("/admin/customers/")) return true;
  if (path === "/admin/reports" || path.startsWith("/admin/reports/")) return true;
  return false;
}

/**
 * Finance managers only see finance product areas (dashboard, invoices, customers).
 * Matched by system role `finance` or department Finance / Accounts.
 */
export function isFinanceUser(
  user: { role?: string | null; department?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (String(user.role ?? "").toLowerCase() === "finance") return true;
  const department = (user.department ?? "").trim().toLowerCase();
  return (
    department === "finance" ||
    department === "accounts" ||
    department === "accounting"
  );
}

/** True only when the system role is `finance` — exclusive finance dashboard/nav. */
export function isFinanceRoleOnly(
  user: { role?: string | null } | null | undefined,
): boolean {
  return String(user?.role ?? "").toLowerCase() === "finance";
}

/** People who can be assigned tasks. HR and finance do not take task work. */
export function isTaskAssignableUser(
  user: { role?: string | null; department?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (isHrUser(user) || isFinanceUser(user)) return false;
  const role = String(user.role ?? "").toLowerCase();
  return role !== "platform";
}

/** Office / ops routes finance managers must not open. */
export function isFinanceRestrictedPath(path: string): boolean {
  if (path === "/tasks" || path.startsWith("/tasks/")) return true;
  if (path === "/admin/tasks" || path.startsWith("/admin/tasks/")) return true;
  if (path === "/admin/client-tasks" || path.startsWith("/admin/client-tasks")) return true;
  if (path === "/projects" || path.startsWith("/projects/")) return true;
  if (path === "/task-chats" || path.startsWith("/task-chats/")) return true;
  if (path === "/time-tracking" || path.startsWith("/time-tracking")) return true;
  if (path === "/analytics" || path.startsWith("/analytics")) return true;
  if (path === "/admin/employees" || path.startsWith("/admin/employees")) return true;
  if (path === "/admin/departments" || path.startsWith("/admin/departments")) return true;
  if (path === "/admin/permissions" || path.startsWith("/admin/permissions")) return true;
  if (path === "/admin/manage-data" || path.startsWith("/admin/manage-data")) return true;
  if (path === "/admin/pricing" || path.startsWith("/admin/pricing")) return true;
  if (path === "/leaves" || path.startsWith("/leaves")) return true;
  if (path === "/leave-management" || path.startsWith("/leave-management")) return true;
  if (path === "/attendance-management" || path.startsWith("/attendance-management")) return true;
  if (path === "/locations" || path.startsWith("/locations")) return true;
  if (path === "/qr-code" || path.startsWith("/qr-code")) return true;
  if (path === "/recent-employees" || path.startsWith("/recent-employees")) return true;
  if (path === "/feed" || path.startsWith("/feed")) return true;
  if (path === "/m/work" || path.startsWith("/m/work")) return true;
  return false;
}

const TASK_NOTIFICATION_TYPES = new Set([
  "task_assigned",
  "task_updated",
  "task_created",
  "project_created",
  "mention",
  "deadline_reminder",
]);

/** Task/project notifications must not be delivered to (or shown for) HR. */
export function isTaskRelatedNotification(notification: {
  type?: string | null;
  taskId?: number | null;
  projectId?: number | null;
}): boolean {
  if (notification.taskId != null) return true;
  if (notification.projectId != null && notification.type === "project_created") return true;
  return TASK_NOTIFICATION_TYPES.has(String(notification.type ?? ""));
}
