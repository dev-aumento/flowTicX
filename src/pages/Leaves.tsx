import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type TouchEvent,
} from "react";
import { trpc } from "@/providers/trpc";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange, DayButton } from "react-day-picker";
import {
  HALF_DAY_REQUIRED_WORK_HOURS,
  LEAVE_TYPE_OPTIONS,
  LEAVE_DURATION_OPTIONS,
  accruedPaidLeavesForYear,
  annualSickLeaveEntitlement,
  annualWfhEntitlement,
  allowsHalfDayLeave,
  alreadyAppliedLeaveMessage,
  canCancelLeaveRequest,
  canEditLeaveRequest,
  durationHint,
  firstOverlappingLeaveDate,
  formatLeaveDays,
  isWorkFromHomeLeave,
  leaveDayUnits,
  leaveTypeLabel,
  wfhRequestBlockedMessage,
  type LeaveDuration,
  type LeaveType,
} from "@/lib/leave-policy";
import { calendarDateValue } from "@/components/time-tracking/WorktimeClockPicker";
import { formatWorkZoneDateKey, formatWorkZoneDateTime, workZoneDateKey, workZoneDateParts } from "@/lib/timezone";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarDays,
  HeartPulse,
  CheckCircle2,
  Home,
  Loader2,
  Umbrella,
  ChevronDown,
  ChevronRight,
  PartyPopper,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { holidayVisualForName } from "@/lib/holiday-icons";
import { HolidayCalendarDayButton } from "@/components/leaves/HolidayCalendarDayButton";
import type { CalendarHolidayBadge } from "@/components/leaves/HolidayCalendarDayButton";
import { PublicHolidayListRow } from "@/components/leaves/PublicHolidayListRow";

type LeaveRequestItem = {
  id: number;
  leaveType: string;
  isHalfDay?: boolean | null;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  reviewNote?: string | null;
  reviewedAt?: Date | string | null;
  createdAt: Date | string;
};

export default function Leaves() {
  const utils = trpc.useUtils();
  const { data: myRequests } = trpc.leave.myRequests.useQuery(undefined, {
    refetchOnWindowFocus: true,
    // Keep pending requests fresh even if the notification stream is delayed.
    refetchInterval: (query) =>
      (query.state.data?.requests ?? []).some((r) => r.status === "pending") ? 10_000 : false,
  });
  const holidayYear = workZoneDateParts(new Date()).year;
  const todayKey = workZoneDateKey(new Date());
  const { data: holidaysData, isLoading: holidaysLoading } = trpc.leave.listHolidays.useQuery({
    year: holidayYear,
  });
  const { data: nextYearHolidaysData } = trpc.leave.listHolidays.useQuery({
    year: holidayYear + 1,
  });
  const holidays = holidaysData?.holidays ?? [];

  /** Date key → holiday badge for the apply-leave calendar (this year + next). */
  const holidayByDate = useMemo(() => {
    const map = new Map<string, CalendarHolidayBadge>();
    for (const h of [...holidays, ...(nextYearHolidaysData?.holidays ?? [])]) {
      const visual = holidayVisualForName(h.name, h.date);
      map.set(h.date, { name: h.name, visual });
    }
    return map;
  }, [holidays, nextYearHolidaysData?.holidays]);

  const holidayDates = useMemo(
    () =>
      [...holidayByDate.keys()].map((key) => {
        const [y, m, d] = key.split("-").map(Number);
        return new Date(y!, m! - 1, d!);
      }),
    [holidayByDate],
  );

  const renderHolidayDayButton = useCallback(
    (props: ComponentProps<typeof DayButton>) => (
      <HolidayCalendarDayButton {...props} holidayByDate={holidayByDate} />
    ),
    [holidayByDate],
  );

  const [range, setRange] = useState<DateRange | undefined>();
  const [singleDate, setSingleDate] = useState<Date | undefined>();
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const calendarSwipeStartX = useRef<number | null>(null);
  const [recentRequestsExpanded, setRecentRequestsExpanded] = useState(false);
  const [holidaysExpanded, setHolidaysExpanded] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>("paid");
  const [duration, setDuration] = useState<LeaveDuration>("full");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);

  const isHalfLeave = duration === "half";

  const shiftCalendarMonth = useCallback((delta: number) => {
    setCalendarMonth((current) => {
      const next = new Date(current);
      next.setDate(1);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  }, []);

  const handleCalendarTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    calendarSwipeStartX.current = event.changedTouches[0]?.clientX ?? null;
  }, []);

  const handleCalendarTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const startX = calendarSwipeStartX.current;
      calendarSwipeStartX.current = null;
      if (startX == null) return;
      const endX = event.changedTouches[0]?.clientX;
      if (endX == null) return;
      const deltaX = endX - startX;
      // Ignore taps / small moves so day selection still works.
      if (Math.abs(deltaX) < 56) return;
      shiftCalendarMonth(deltaX < 0 ? 1 : -1);
    },
    [shiftCalendarMonth],
  );

  const selectedRequest = useMemo(() => {
    if (selectedRequestId == null) return null;
    return (
      ((myRequests?.requests ?? []) as LeaveRequestItem[]).find(
        (r) => r.id === selectedRequestId,
      ) ?? null
    );
  }, [myRequests?.requests, selectedRequestId]);

  const applyMutation = trpc.leave.submitRequest.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(
        isWorkFromHomeLeave(variables.leaveType)
          ? "Work from home request submitted"
          : "Leave request submitted",
      );
      setRange(undefined);
      setSingleDate(undefined);
      setReason("");
      setError(null);
      setDuration("full");
      await Promise.all([
        utils.leave.myBalance.invalidate(),
        utils.leave.myRequests.invalidate(),
      ]);
    },
    onError: (err) => {
      const message = err.message || "Could not submit leave request";
      setError(message);
      toast.error(message);
    },
  });

  const startDate = isHalfLeave
    ? singleDate
      ? calendarDateValue(singleDate)
      : ""
    : range?.from
      ? calendarDateValue(range.from)
      : "";
  const endDate = isHalfLeave
    ? startDate
    : range?.to
      ? calendarDateValue(range.to)
      : range?.from
        ? calendarDateValue(range.from)
        : "";

  /** Balance follows the leave year of the selected dates (defaults to current year). */
  const balanceYear = startDate ? Number(startDate.slice(0, 4)) : holidayYear;
  const { data: balance, isLoading: balanceLoading } = trpc.leave.myBalance.useQuery(
    { year: balanceYear },
    { refetchOnWindowFocus: true },
  );

  const days =
    startDate && endDate
      ? leaveDayUnits(leaveType, startDate, endDate, isHalfLeave)
      : 0;

  const handleLeaveTypeChange = (next: LeaveType) => {
    setLeaveType(next);
    setError(null);
    // WFH is full-day only; force full duration when selected.
    if (isWorkFromHomeLeave(next) && duration === "half") {
      const day = singleDate ?? range?.from;
      setDuration("full");
      if (day) setRange({ from: day, to: day });
      setSingleDate(undefined);
      return;
    }
    // Keep current duration; switch calendar mode if half is selected.
    if (duration === "half") {
      const day = range?.from ?? singleDate;
      setSingleDate(day);
      setRange(undefined);
    }
  };

  const handleDurationChange = (next: LeaveDuration) => {
    if (next === "half" && !allowsHalfDayLeave(leaveType)) return;
    const wasHalf = duration === "half";
    setDuration(next);
    setError(null);
    if (next === "half") {
      const day = range?.from ?? singleDate;
      setSingleDate(day);
      setRange(undefined);
    } else if (wasHalf && singleDate) {
      setRange({ from: singleDate, to: singleDate });
    }
  };

  const paidUsed = balance?.paidUsed ?? 0;
  const sickUsed = balance?.sickUsed ?? 0;
  const wfhUsed = balance?.wfhUsed ?? 0;
  const paidTotal =
    balance?.paidTotal ??
    accruedPaidLeavesForYear(
      balanceYear,
      new Date(),
      balance?.dateOfJoining ?? null,
      balance?.employmentType ?? null,
      balance?.onNoticePeriod ?? false,
    );
  const paidRemaining =
    balance?.paidRemaining ?? Math.max(0, paidTotal - (paidUsed + (balance?.paidPending ?? 0)));
  const sickTotal =
    balance?.sickTotal ??
    annualSickLeaveEntitlement(balanceYear, balance?.dateOfJoining ?? null);
  const sickRemaining =
    balance?.sickRemaining ?? Math.max(0, sickTotal - (sickUsed + (balance?.sickPending ?? 0)));
  const wfhTotal =
    balance?.wfhTotal ??
    annualWfhEntitlement(balanceYear, balance?.dateOfJoining ?? null);
  const wfhRemaining =
    balance?.wfhRemaining ?? Math.max(0, wfhTotal - (wfhUsed + (balance?.wfhPending ?? 0)));
  const wfhBlockedReason = wfhRequestBlockedMessage({
    onNoticePeriod: balance?.onNoticePeriod,
    dateOfJoining: balance?.dateOfJoining ?? null,
    employmentType: balance?.employmentType ?? null,
  });

  useEffect(() => {
    if (!wfhBlockedReason || !isWorkFromHomeLeave(leaveType)) return;
    setLeaveType("paid");
  }, [wfhBlockedReason, leaveType]);

  const cards = useMemo(
    () => [
      {
        title: "Paid leaves (PL)",
        value: paidRemaining,
        icon: Umbrella,
        iconColor: "#2563EB",
        badge: { text: "Remaining", bg: "#DBEAFE", color: "#2563EB" },
        subtext: balance?.onNoticePeriod
          ? `No PL during notice period · ${paidUsed} used of ${paidTotal}`
          : balance?.inProbation
          ? `No PL during ${balance.paidLeaveLockLabel ?? "probation"} · ${paidUsed} used of ${paidTotal}`
          : `${paidUsed} used · ${balance?.paidPending ?? 0} pending · of ${paidTotal} accrued (${balanceYear})`,
      },
      {
        title: "Sick leaves (SL)",
        value: sickRemaining,
        icon: HeartPulse,
        iconColor: "#DC2626",
        badge: { text: "Remaining", bg: "#FEE2E2", color: "#DC2626" },
        subtext: `${sickUsed} used · ${balance?.sickPending ?? 0} pending · of ${sickTotal} in ${balanceYear}`,
      },
      {
        title: "Work from home (WFH)",
        value: wfhRemaining,
        icon: Home,
        iconColor: "#0D9488",
        badge: { text: "Remaining", bg: "#CCFBF1", color: "#0F766E" },
        subtext: balance?.onNoticePeriod
          ? `No WFH during notice period · ${wfhUsed} used of ${wfhTotal}`
          : balance?.inProbation
          ? `No WFH during ${balance.paidLeaveLockLabel ?? "probation"} · ${wfhUsed} used of ${wfhTotal}`
          : `${wfhUsed} used · ${balance?.wfhPending ?? 0} pending · of ${wfhTotal} in ${balanceYear}`,
      },
    ],
    [
      balance,
      paidUsed,
      sickUsed,
      wfhUsed,
      paidTotal,
      paidRemaining,
      sickTotal,
      sickRemaining,
      wfhTotal,
      wfhRemaining,
      balanceYear,
    ],
  );

  const handleSubmit = () => {
    setError(null);
    if (!startDate || !endDate) {
      setError("Please select a leave date (or date range) on the calendar.");
      return;
    }
    if (!reason.trim() || reason.trim().length < 3) {
      setError("Please enter a reason (at least 3 characters).");
      return;
    }

    const requestEnd = isHalfLeave ? startDate : endDate;
    const conflicting = ((myRequests?.requests ?? []) as LeaveRequestItem[]).find((req) => {
      if (req.status !== "pending" && req.status !== "approved") return false;
      return Boolean(firstOverlappingLeaveDate(startDate, requestEnd, req));
    });
    if (conflicting) {
      const message = alreadyAppliedLeaveMessage();
      setError(message);
      toast.error(message);
      return;
    }

    if (isWorkFromHomeLeave(leaveType) && wfhBlockedReason) {
      setError(wfhBlockedReason);
      toast.error(wfhBlockedReason);
      return;
    }

    applyMutation.mutate({
      leaveType: leaveType as "paid" | "sick" | "unpaid" | "wfh",
      startDate,
      endDate,
      reason: reason.trim(),
      isHalfDay: isHalfLeave && allowsHalfDayLeave(leaveType),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div>
        <div className="flex items-center gap-3 mb-1">
          <CalendarDays size={24} className="text-[#0EA5E9]" />
          <h1 className="text-2xl font-bold text-[#1F2937]">Leaves</h1>
        </div>
        <p className="text-sm text-gray-500">
          Track your leave balance and apply for time off.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {cards.map((card) => (
          <div
            key={card.title}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <card.icon size={22} style={{ color: card.iconColor }} />
                <span className="text-xs font-medium text-gray-500">{card.title}</span>
              </div>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: card.badge.bg, color: card.badge.color }}
              >
                {card.badge.text}
              </span>
            </div>
            <div className="text-3xl font-bold text-[#1F2937] mb-1">
              {balanceLoading ? "—" : Number(card.value)}
            </div>
            <div className="text-xs text-gray-500">{card.subtext}</div>
          </div>
        ))}

        <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={22} className="text-emerald-600" />
              <span className="text-xs font-medium text-gray-500">Used leaves</span>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
              Approved
            </span>
          </div>
          {balanceLoading ? (
            <div className="text-3xl font-bold text-[#1F2937] mb-1">—</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 mb-1">
              <div>
                <div className="text-3xl font-bold text-[#1F2937]">{paidUsed}</div>
                <div className="text-xs font-medium text-blue-600 mt-0.5">Paid (PL)</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-[#1F2937]">{sickUsed}</div>
                <div className="text-xs font-medium text-red-600 mt-0.5">Sick (SL)</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-[#1F2937]">{wfhUsed}</div>
                <div className="text-xs font-medium text-teal-600 mt-0.5">WFH</div>
              </div>
            </div>
          )}
          <div className="text-xs text-gray-500">Approved leave &amp; WFH days by type</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-lg font-semibold text-[#1F2937]">Apply Leave</h2>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(22rem,24rem)_1fr] gap-6 items-start">
          <div className="rounded-xl border border-gray-200 w-full self-start flex flex-col overflow-hidden">
            <div
              className="relative touch-manipulation"
              onTouchStart={handleCalendarTouchStart}
              onTouchEnd={handleCalendarTouchEnd}
            >
              {isHalfLeave ? (
                <Calendar
                  mode="single"
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  selected={singleDate}
                  onSelect={setSingleDate}
                  numberOfMonths={1}
                  disabled={[
                    { before: new Date(new Date().setHours(0, 0, 0, 0)) },
                    { dayOfWeek: [0, 6] },
                  ]}
                  modifiers={{ holiday: holidayDates }}
                  modifiersClassNames={{
                    holiday: "font-medium",
                  }}
                  components={{ DayButton: renderHolidayDayButton }}
                  className="w-full"
                />
              ) : (
                <Calendar
                  mode="range"
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  selected={range}
                  onSelect={setRange}
                  numberOfMonths={1}
                  disabled={[
                    { before: new Date(new Date().setHours(0, 0, 0, 0)) },
                    { dayOfWeek: [0, 6] },
                  ]}
                  modifiers={{ holiday: holidayDates }}
                  modifiersClassNames={{
                    holiday: "font-medium",
                  }}
                  components={{ DayButton: renderHolidayDayButton }}
                  className="w-full"
                />
              )}
            </div>
            <div className="relative z-10 px-4 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 min-h-[2.75rem] leading-relaxed">
              {startDate ? (
                isHalfLeave ? (
                  <>
                    Selected:{" "}
                    <span className="font-medium text-gray-700">
                      {formatWorkZoneDateKey(startDate, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>{" "}
                    {leaveType === "sick"
                      ? `(half day · 0.5 SL · requires ${HALF_DAY_REQUIRED_WORK_HOURS}h work)`
                      : leaveType === "unpaid"
                        ? `(half day · unpaid · requires ${HALF_DAY_REQUIRED_WORK_HOURS}h work)`
                        : `(half day · 0.5 PL · requires ${HALF_DAY_REQUIRED_WORK_HOURS}h work)`}
                  </>
                ) : days <= 1 ? (
                  <>
                    Selected:{" "}
                    <span className="font-medium text-gray-700">
                      {formatWorkZoneDateKey(startDate, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>{" "}
                    (1 day)
                  </>
                ) : (
                  <>
                    Selected:{" "}
                    <span className="font-medium text-gray-700">
                      {formatWorkZoneDateKey(startDate, {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      →{" "}
                      {formatWorkZoneDateKey(endDate, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>{" "}
                    ({formatLeaveDays(days)} · weekdays only)
                  </>
                )
              ) : isHalfLeave ? (
                "Select a weekday (Mon–Fri) for half-day leave. Sat/Sun are off."
              ) : (
                "Select a weekday (Mon–Fri). Ranges can span weekends; Sat/Sun don’t count."
              )}
            </div>
            <p className="relative z-10 px-4 pb-2 text-[11px] text-gray-400 lg:hidden">
              Swipe left or right to change month
            </p>
          </div>

          <div className="space-y-4 min-w-0">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Leave type
              </label>
              <div className="flex flex-wrap gap-2">
                {LEAVE_TYPE_OPTIONS.map((opt) => {
                  const wfhLocked =
                    isWorkFromHomeLeave(opt.value) && Boolean(wfhBlockedReason);
                  return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={wfhLocked}
                    onClick={() => handleLeaveTypeChange(opt.value)}
                    className={`h-9 px-3 rounded-lg text-sm font-medium border transition-colors ${
                      leaveType === opt.value
                        ? "bg-[#2563EB] text-white border-[#2563EB]"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {opt.label}
                  </button>
                  );
                })}
              </div>
              {wfhBlockedReason ? (
                <p className="text-xs text-amber-700 mt-2">{wfhBlockedReason}.</p>
              ) : null}

              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Duration
                </label>
                <div className="flex flex-wrap gap-2">
                  {LEAVE_DURATION_OPTIONS.map((opt) => {
                    const disabled =
                      opt.value === "half" && !allowsHalfDayLeave(leaveType);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleDurationChange(opt.value)}
                        className={`h-9 px-3 rounded-lg text-sm font-medium border transition-colors ${
                          duration === opt.value
                            ? "bg-[#2563EB] text-white border-[#2563EB]"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {durationHint(leaveType, duration)}
                  {leaveType === "unpaid"
                    ? " Does not deduct from PL or SL balance."
                    : ""}
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="leave-reason"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Reason
              </label>
              <textarea
                id="leave-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={6}
                placeholder="Reason for applying leave…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] resize-y min-h-[140px]"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                applyMutation.isPending ||
                (isWorkFromHomeLeave(leaveType) && Boolean(wfhBlockedReason))
              }
              className="h-10 px-6 bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-blue-200 transition-all inline-flex items-center gap-2 disabled:opacity-60"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Submitting…
                </>
              ) : (
                "Apply"
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setRecentRequestsExpanded((open) => !open)}
          aria-expanded={recentRequestsExpanded}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#1F2937]">My recent requests</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {!recentRequestsExpanded
                ? `${myRequests?.requests?.length ?? 0} request${(myRequests?.requests?.length ?? 0) === 1 ? "" : "s"}`
                : "Tap a request to view details"}
            </p>
          </div>
          <ChevronDown
            size={18}
            className={cn(
              "shrink-0 text-gray-400 transition-transform",
              recentRequestsExpanded && "rotate-180",
            )}
          />
        </button>
        {recentRequestsExpanded ? (
          (myRequests?.requests?.length ?? 0) > 0 ? (
            <div className="divide-y divide-gray-50 border-t border-gray-100">
              {myRequests!.requests.map((req) => (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => setSelectedRequestId(req.id)}
                  className="w-full text-left px-5 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-800">
                      {leaveTypeLabel(req.leaveType as LeaveType, {
                        isHalfDay: req.isHalfDay,
                        days: req.days,
                      })}{" "}
                      · {formatLeaveDays(req.days)}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                      {req.startDate === req.endDate
                        ? req.startDate
                        : `${req.startDate} → ${req.endDate}`}
                      {" · "}
                      {req.reason}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={req.status} />
                    <ChevronRight size={16} className="text-gray-300" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-gray-500 text-center border-t border-gray-100">
              No leave requests yet.
            </div>
          )
        ) : null}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setHolidaysExpanded((open) => !open)}
          aria-expanded={holidaysExpanded}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <PartyPopper size={18} className="text-amber-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#1F2937]">
                Public holidays {holidayYear}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Company holidays set by HR / admin
                {!holidaysExpanded && holidays.length > 0
                  ? ` · ${holidays.length} in ${holidayYear}`
                  : ""}
              </p>
            </div>
          </div>
          <ChevronDown
            size={18}
            className={cn(
              "shrink-0 text-gray-400 transition-transform",
              holidaysExpanded && "rotate-180",
            )}
          />
        </button>
        {holidaysExpanded ? (
          holidaysLoading ? (
            <div className="flex justify-center py-10 border-t border-gray-100">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : holidays.length === 0 ? (
            <div className="px-5 py-8 text-sm text-gray-500 text-center border-t border-gray-100">
              No public holidays published for {holidayYear} yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-50 border-t border-gray-100">
              {holidays.map((holiday) => (
                <PublicHolidayListRow
                  key={holiday.id}
                  date={holiday.date}
                  name={holiday.name}
                  todayKey={todayKey}
                  className="px-5 py-3"
                />
              ))}
            </div>
          )
        ) : null}
      </div>

      <LeaveRequestDetailDialog
        request={selectedRequest}
        open={selectedRequestId != null}
        onOpenChange={(open) => {
          if (!open) setSelectedRequestId(null);
        }}
        onCancelled={() => setSelectedRequestId(null)}
        wfhBlockedReason={wfhBlockedReason}
      />
    </motion.div>
  );
}

function LeaveRequestDetailDialog({
  request,
  open,
  onOpenChange,
  onCancelled,
  wfhBlockedReason,
}: {
  request: LeaveRequestItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled?: () => void;
  wfhBlockedReason?: string | null;
}) {
  const utils = trpc.useUtils();
  const todayKey = workZoneDateKey(new Date());
  const canCancel = request
    ? canCancelLeaveRequest(
        { status: request.status, startDate: request.startDate },
        todayKey,
      )
    : false;
  const canEdit = request
    ? canEditLeaveRequest(
        { status: request.status, startDate: request.startDate },
        todayKey,
      )
    : false;

  const [editing, setEditing] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>("paid");
  const [duration, setDuration] = useState<LeaveDuration>("full");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!request || !open) {
      setEditing(false);
      setEditError(null);
      return;
    }
    setLeaveType(
      request.leaveType === "half" ? "paid" : (request.leaveType as LeaveType),
    );
    setDuration(
      request.isHalfDay || request.leaveType === "half" || request.days === 0.5
        ? "half"
        : "full",
    );
    setStartDate(request.startDate);
    setEndDate(request.endDate);
    setReason(request.reason);
    setEditing(false);
    setEditError(null);
  }, [request, open]);

  const cancelMutation = trpc.leave.cancelRequest.useMutation({
    onSuccess: async () => {
      toast.success(
        request && isWorkFromHomeLeave(request.leaveType)
          ? "Work from home request cancelled"
          : "Leave request cancelled",
      );
      await Promise.all([
        utils.leave.myBalance.invalidate(),
        utils.leave.myRequests.invalidate(),
        utils.leave.listPending.invalidate(),
        utils.timeEntry.getStats.invalidate(),
      ]);
      onCancelled?.();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err.message || "Could not cancel leave request");
    },
  });

  const updateMutation = trpc.leave.updateMyRequest.useMutation({
    onSuccess: async () => {
      toast.success(
        request && isWorkFromHomeLeave(request.leaveType)
          ? "Work from home request updated"
          : "Leave request updated",
      );
      setEditing(false);
      await Promise.all([
        utils.leave.myBalance.invalidate(),
        utils.leave.myRequests.invalidate(),
        utils.leave.listPending.invalidate(),
        utils.timeEntry.getStats.invalidate(),
      ]);
    },
    onError: (err) => {
      const message = err.message || "Could not update leave request";
      setEditError(message);
      toast.error(message);
    },
  });

  if (!request) return null;

  const isHalfDay = duration === "half";
  const effectiveEnd = isHalfDay ? startDate : endDate || startDate;
  const previewDays =
    startDate && effectiveEnd
      ? leaveDayUnits(leaveType, startDate, effectiveEnd, isHalfDay)
      : 0;

  const dateLabel =
    request.startDate === request.endDate
      ? formatWorkZoneDateKey(request.startDate, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : `${formatWorkZoneDateKey(request.startDate, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })} → ${formatWorkZoneDateKey(request.endDate, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`;

  const handleSaveEdit = () => {
    setEditError(null);
    if (!startDate) {
      setEditError("Please select a start date.");
      return;
    }
    if (!isHalfDay && !endDate) {
      setEditError("Please select an end date.");
      return;
    }
    if (!reason.trim() || reason.trim().length < 3) {
      setEditError("Please enter a reason (at least 3 characters).");
      return;
    }
    if (previewDays <= 0) {
      setEditError("Please choose a valid weekday date range.");
      return;
    }
    if (isWorkFromHomeLeave(leaveType) && wfhBlockedReason) {
      setEditError(wfhBlockedReason);
      toast.error(wfhBlockedReason);
      return;
    }
    updateMutation.mutate({
      id: request.id,
      leaveType: leaveType as "paid" | "sick" | "unpaid" | "wfh",
      startDate,
      endDate: effectiveEnd,
      reason: reason.trim(),
      isHalfDay: isHalfDay && allowsHalfDayLeave(leaveType),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Leave request details</DialogTitle>
          <DialogDescription>
            {leaveTypeLabel(request.leaveType as LeaveType, {
              isHalfDay: request.isHalfDay,
              days: request.days,
            })}{" "}
            · {formatLeaveDays(request.days)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-400">Status</span>
            <StatusBadge status={request.status} />
          </div>

          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Leave type</label>
                <div className="flex flex-wrap gap-2">
                  {LEAVE_TYPE_OPTIONS.map((opt) => {
                    const wfhLocked =
                      isWorkFromHomeLeave(opt.value) && Boolean(wfhBlockedReason);
                    return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={wfhLocked}
                      onClick={() => {
                        if (wfhLocked) return;
                        setLeaveType(opt.value);
                        if (isWorkFromHomeLeave(opt.value)) {
                          setDuration("full");
                        }
                      }}
                      className={cn(
                        "h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        leaveType === opt.value
                          ? "border-[#2563EB] bg-blue-50 text-[#2563EB]"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50",
                      )}
                    >
                      {opt.short}
                    </button>
                    );
                  })}
                </div>
                {wfhBlockedReason ? (
                  <p className="text-[11px] text-amber-700 mt-1.5">{wfhBlockedReason}.</p>
                ) : null}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Duration</label>
                <div className="flex flex-wrap gap-2">
                  {LEAVE_DURATION_OPTIONS.map((opt) => {
                    const disabled =
                      opt.value === "half" && !allowsHalfDayLeave(leaveType);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          setDuration(opt.value);
                          if (opt.value === "half") setEndDate(startDate);
                        }}
                        className={cn(
                          "h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          duration === opt.value
                            ? "border-[#2563EB] bg-blue-50 text-[#2563EB]"
                            : "border-gray-200 text-gray-600 hover:bg-gray-50",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {durationHint(leaveType, duration)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Start date</label>
                  <input
                    type="date"
                    value={startDate}
                    min={todayKey}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (isHalfDay || (endDate && endDate < e.target.value)) {
                        setEndDate(e.target.value);
                      }
                    }}
                    className="w-full h-9 px-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">End date</label>
                  <input
                    type="date"
                    value={isHalfDay ? startDate : endDate}
                    min={startDate || todayKey}
                    disabled={isHalfDay}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:bg-gray-50"
                  />
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Duration:{" "}
                <span className="font-medium text-gray-700">
                  {previewDays > 0 ? formatLeaveDays(previewDays) : "—"}
                </span>
                {previewDays > 1 ? " · weekdays only" : null}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>

              {request.status === "approved" ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Saving will re-submit this request as pending for HR review.
                </p>
              ) : null}

              {editError ? (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {editError}
                </p>
              ) : null}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => {
                    setEditing(false);
                    setEditError(null);
                    setLeaveType(
                      request.leaveType === "half"
                        ? "paid"
                        : (request.leaveType as LeaveType),
                    );
                    setDuration(
                      request.isHalfDay ||
                        request.leaveType === "half" ||
                        request.days === 0.5
                        ? "half"
                        : "full",
                    );
                    setStartDate(request.startDate);
                    setEndDate(request.endDate);
                    setReason(request.reason);
                  }}
                  className="flex-1 h-10 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={
                    updateMutation.isPending ||
                    (isWorkFromHomeLeave(leaveType) && Boolean(wfhBlockedReason))
                  }
                  onClick={handleSaveEdit}
                  className="flex-1 h-10 rounded-lg bg-[#2563EB] text-white text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </button>
              </div>
            </div>
          ) : (
            <>
              <DetailRow
                label="Leave type"
                value={leaveTypeLabel(request.leaveType as LeaveType, {
                  isHalfDay: request.isHalfDay,
                  days: request.days,
                })}
              />
              <DetailRow label="Dates" value={dateLabel} />
              <DetailRow label="Duration" value={formatLeaveDays(request.days)} />
              <DetailRow label="Reason" value={request.reason} />
              <DetailRow
                label="Applied on"
                value={formatWorkZoneDateTime(request.createdAt)}
              />

              {request.status !== "pending" && request.status !== "cancelled" && (
                <>
                  {request.reviewedAt ? (
                    <DetailRow
                      label={
                        request.status === "approved" ? "Approved on" : "Rejected on"
                      }
                      value={formatWorkZoneDateTime(request.reviewedAt)}
                    />
                  ) : null}
                  {request.reviewNote ? (
                    <DetailRow label="Review note" value={request.reviewNote} />
                  ) : null}
                </>
              )}
              {request.status === "cancelled" && request.reviewedAt ? (
                <DetailRow
                  label="Cancelled on"
                  value={formatWorkZoneDateTime(request.reviewedAt)}
                />
              ) : null}

              {(canEdit || canCancel) && (
                <div className="pt-2 border-t border-gray-100 space-y-2">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="h-10 w-full rounded-lg border border-[#2563EB]/30 bg-blue-50 text-sm font-semibold text-[#2563EB] hover:bg-blue-100 transition-colors"
                    >
                      Edit leave
                    </button>
                  ) : null}
                  {canCancel ? (
                    <>
                      <p className="text-xs text-gray-500">
                        Cancelling restores your leave balance and notifies HR/admin.
                      </p>
                      <button
                        type="button"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate({ id: request.id })}
                        className="h-10 w-full rounded-lg border border-red-200 bg-red-50 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                      >
                        {cancelMutation.isPending ? (
                          <>
                            <Loader2 size={16} className="animate-spin" /> Cancelling…
                          </>
                        ) : (
                          "Cancel leave"
                        )}
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-sm text-[#1F2937] whitespace-pre-wrap">{value || "—"}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : status === "rejected"
        ? "bg-red-50 text-red-600"
        : status === "cancelled"
          ? "bg-gray-100 text-gray-600"
          : "bg-amber-50 text-amber-700";
  return (
    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize ${styles}`}>
      {status}
    </span>
  );
}
