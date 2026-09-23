import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLiveSessionTimers } from "@/hooks/useLiveSessionTimers";
import { formatElapsedHMS } from "@/lib/utils";
import { DailyBreakdownChart } from "@/components/time-tracking/DailyBreakdownChart";
import { DayHoursSection } from "@/components/time-tracking/DayHoursSection";
import { BreaksPanel } from "@/components/time-tracking/BreaksPanel";
import { ManualClockInRequestForm } from "@/components/time-tracking/ManualClockInRequestForm";
import { CrossDayClockOutDialog } from "@/components/time-tracking/CrossDayClockOutDialog";
import { useClockOutAction } from "@/hooks/useClockOutAction";
import { invalidateActiveTaskTimers } from "@/lib/invalidate-task-timers";
import { runClockInWithLocation } from "@/lib/clock-in-with-location";
import { TimeApprovalPanel } from "@/components/time-tracking/TimeApprovalPanel";
import { toast } from "sonner";
import {
  fillBreakdownForPeriod,
  formatHoursMinutes,
  formatPeriodRangeLabel,
  listBreakdownForPeriod,
  periodBreakdownSubtitle,
  REQUIRED_DAILY_HOURS,
  REQUIRED_WEEKLY_HOURS,
  WORKING_DAYS_PER_WEEK,
  formatPreciseWorkedClock,
  formatPreciseWorkedTime,
  formatHoursMinutesFloored,
  isDateInCalendarWeek,
  localDateKey,
  periodRangeStart,
  roundHours,
  splitRegularAndOvertime,
  workedSecondsFromStats,
} from "@/lib/work-hours-policy";
import { formatWorkZoneDateKey, formatWorkZoneTime } from "@/lib/timezone";
import { isAdminOrManagement } from "@/lib/leave-policy";
import {
  Play, Square, Timer, Clock, TrendingUp,
  Loader2, Pause, AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";

function ProgressCard({
  label,
  workedSeconds,
  required,
  overtimeSeconds,
  icon: Icon,
  sub,
}: {
  label: string;
  workedSeconds: number;
  required: number;
  overtimeSeconds: number;
  icon: LucideIcon;
  sub: string;
}) {
  const workedHours = workedSeconds / 3600;
  const progress = required > 0 ? Math.min(100, (workedHours / required) * 100) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={18} className="text-[#2563EB]" />
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-[#1F2937] font-mono tracking-tight">
        {formatPreciseWorkedClock(workedSeconds)}
        <span className="text-base font-medium text-gray-400 font-sans"> / {required}h</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#2563EB] transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-2 text-xs">
        <span className="text-gray-400">{sub}</span>
        {overtimeSeconds > 0 ? (
          <span className="font-semibold text-amber-600">
            OT {formatPreciseWorkedTime(overtimeSeconds)}
          </span>
        ) : (
          <span className="text-gray-400">No OT</span>
        )}
      </div>
    </div>
  );
}

export default function TimeTracking() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [note, setNote] = useState("");
  const isAdmin = user?.role === "admin";
  const isHR = user?.role === "hr";
  const hidePersonalTime = isAdminOrManagement(user);

  const { data: currentSession } = trpc.timeEntry.getCurrentSession.useQuery(undefined, {
    enabled: !hidePersonalTime,
  });
  const { data: weekStats } = trpc.timeEntry.getStats.useQuery(
    { period: "week" },
    { enabled: !hidePersonalTime },
  );
  const { data: todayStats } = trpc.timeEntry.getStats.useQuery(
    { period: "today" },
    { enabled: !hidePersonalTime },
  );
  const { data: stats, isFetching: statsLoading, isPlaceholderData } = trpc.timeEntry.getStats.useQuery(
    { period },
    { enabled: !hidePersonalTime },
  );
  const utils = trpc.useUtils();

  const periodSummaryLabel = formatPeriodRangeLabel(period);
  const breakdownSubtitle = periodBreakdownSubtitle(period);
  const monthOtHours = stats?.dailyOvertimeHours ?? stats?.overtimeHours ?? 0;

  const clockOutAction = useClockOutAction(() => {
    setNote("");
  });

  const clockInMutation = trpc.timeEntry.clockIn.useMutation({
    onSuccess: () => {
      utils.timeEntry.getCurrentSession.invalidate();
      utils.timeEntry.getStats.invalidate();
      utils.timeEntry.getDayHours.invalidate();
      utils.timeEntry.getTeamHours.invalidate();
      utils.timeEntry.getBreaks.invalidate();
      utils.timeEntry.listPendingApprovals.invalidate();
      utils.dashboard.getStats.invalidate();
      setNote("");
    },
    onError: (err) => toast.error(err.message || "Could not clock in"),
  });

  const pauseMutation = trpc.timeEntry.pauseSession.useMutation({
    onSuccess: () => {
      utils.timeEntry.getCurrentSession.invalidate();
      utils.timeEntry.getStats.invalidate();
      utils.timeEntry.getDayHours.invalidate();
      utils.timeEntry.getTeamHours.invalidate();
      utils.timeEntry.getBreaks.invalidate();
      invalidateActiveTaskTimers(utils);
    },
  });

  const resumeMutation = trpc.timeEntry.resumeSession.useMutation({
    onSuccess: () => {
      utils.timeEntry.getCurrentSession.invalidate();
      utils.timeEntry.getStats.invalidate();
      utils.timeEntry.getDayHours.invalidate();
      utils.timeEntry.getTeamHours.invalidate();
      utils.timeEntry.getBreaks.invalidate();
    },
  });

  const isClockedIn = !!currentSession?.active;
  const isPaused = !!currentSession?.paused;
  const { workSeconds, breakSeconds } = useLiveSessionTimers(
    isClockedIn ? currentSession : null,
  );
  const priorWorkSeconds = currentSession?.priorDayWorkSeconds ?? 0;
  const cumulativeWorkSeconds = priorWorkSeconds + workSeconds;
  const hasWorkedToday = (todayStats?.totalSeconds ?? 0) > 0;
  const displaySeconds = isPaused ? breakSeconds : cumulativeWorkSeconds;

  const todayKey = localDateKey(new Date());
  const todayIncludeLive =
    !!todayStats?.activeSession && todayStats.activeSession.date === todayKey;

  const todayRequiredHours = todayStats?.requiredDailyHours ?? REQUIRED_DAILY_HOURS;
  const weekRequiredHours = weekStats?.requiredWeeklyHours ?? REQUIRED_WEEKLY_HOURS;
  const periodWeekRequired =
    stats?.requiredWeeklyHours ?? REQUIRED_WEEKLY_HOURS;

  const todayWorked = useMemo(() => {
    const workedSeconds = workedSecondsFromStats(
      todayStats,
      workSeconds,
      todayIncludeLive,
    );
    const workedHours = workedSeconds / 3600;
    const { regularHours, overtimeHours } = splitRegularAndOvertime(
      workedHours,
      todayRequiredHours,
    );
    return {
      workedSeconds,
      regularSeconds: Math.round(regularHours * 3600),
      overtimeSeconds: Math.round(overtimeHours * 3600),
    };
  }, [todayStats, workSeconds, todayIncludeLive, todayRequiredHours]);

  const weekIncludeLive =
    !!weekStats?.activeSession &&
    isDateInCalendarWeek(weekStats.activeSession.date);

  const weekWorked = useMemo(() => {
    const workedSeconds = workedSecondsFromStats(
      weekStats,
      workSeconds,
      weekIncludeLive,
    );
    const workedHours = workedSeconds / 3600;
    const { regularHours, overtimeHours } = splitRegularAndOvertime(
      workedHours,
      weekRequiredHours,
    );
    return {
      workedSeconds,
      regularSeconds: Math.round(regularHours * 3600),
      overtimeSeconds: Math.round(overtimeHours * 3600),
    };
  }, [weekStats, workSeconds, weekIncludeLive, weekRequiredHours]);

  const periodIncludeLive =
    !!stats?.activeSession &&
    (period === "week"
      ? isDateInCalendarWeek(stats.activeSession.date)
      : stats.activeSession.date >= localDateKey(periodRangeStart("month")));

  const periodWorkedSeconds = useMemo(() => {
    return workedSecondsFromStats(stats, workSeconds, periodIncludeLive);
  }, [stats, workSeconds, periodIncludeLive]);

  const periodOvertime = useMemo(() => {
    if (period === "week") {
      const workedHours = periodWorkedSeconds / 3600;
      return Math.max(0, workedHours - periodWeekRequired);
    }
    return stats?.dailyOvertimeHours ?? stats?.overtimeHours ?? 0;
  }, [period, periodWorkedSeconds, stats, periodWeekRequired]);

  const periodData = useMemo(() => {
    const filled = fillBreakdownForPeriod(stats?.dailyBreakdown ?? [], period);
    if (!stats?.activeSession) return filled;

    const includeLive =
      period === "week"
        ? isDateInCalendarWeek(stats.activeSession.date)
        : stats.activeSession.date >= localDateKey(periodRangeStart("month"));

    if (!includeLive) return filled;

    const liveSeconds = workSeconds;
    const snapshotSeconds = stats.activeSession.workSeconds;
    const deltaSeconds = liveSeconds - snapshotSeconds;
    if (Math.abs(deltaSeconds) < 1) return filled;

    return filled.map((day) => {
      if (day.date !== stats.activeSession!.date) return day;
      const nextSeconds = Math.max(0, Math.round(day.hours * 3600) + deltaSeconds);
      const hours = roundHours(nextSeconds / 3600);
      const dayRequired = day.requiredHours ?? REQUIRED_DAILY_HOURS;
      const { regularHours, overtimeHours } = splitRegularAndOvertime(
        hours,
        dayRequired,
      );
      return {
        ...day,
        hours,
        minutes: Math.floor(nextSeconds / 60),
        regularHours: roundHours(regularHours),
        overtimeHours: roundHours(overtimeHours),
        requiredHours: dayRequired,
      };
    });
  }, [stats?.dailyBreakdown, stats?.activeSession, period, workSeconds]);

  const chartData = periodData;

  const listDays = useMemo(
    () => listBreakdownForPeriod(periodData),
    [periodData],
  );

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  };

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-2xl font-bold text-[#1F2937]">
          {hidePersonalTime ? "Employee Hours" : "Time Tracking"}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {hidePersonalTime
            ? "Review employee hours and time approval requests"
            : `Required: ${REQUIRED_DAILY_HOURS}h/day · ${WORKING_DAYS_PER_WEEK} weekdays · ${REQUIRED_WEEKLY_HOURS}h/week · half leave requires 5h that day · leave adjusts weekly target`}
        </p>
      </motion.div>

      {!hidePersonalTime ? (
        <>
      {/* Clock In/Out Hero Card */}
      <motion.div variants={itemVariants} className="portal-slate-gradient rounded-2xl p-6 text-white shadow-md">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0">
            <div className="text-blue-100 text-sm font-medium mb-1">
              {isClockedIn
                ? isPaused
                  ? "On Break"
                  : "Currently Working"
                : hasWorkedToday
                  ? "Welcome back"
                  : "Ready to Start?"}
            </div>
            {isClockedIn && (
              <div className="text-3xl sm:text-4xl font-bold font-mono tracking-wider">
                {formatElapsedHMS(displaySeconds)}
              </div>
            )}
            {!isClockedIn && (
              <div className="text-xl sm:text-2xl font-bold">
                {hasWorkedToday ? "Clock in again" : "Clock in to start tracking"}
              </div>
            )}
            <div className="text-blue-100 text-xs mt-2">
              {isClockedIn
                ? isPaused
                  ? `Work paused at ${formatElapsedHMS(cumulativeWorkSeconds)} · break running`
                  : `Today's total ${formatElapsedHMS(cumulativeWorkSeconds)} · started ${formatWorkZoneTime(currentSession!.startTime, { hour: "2-digit", minute: "2-digit" })}`
                : hasWorkedToday
                  ? `You've logged ${formatPreciseWorkedClock(todayStats?.totalSeconds ?? 0)} today — pick up where you left off`
                  : "Your last session ended recently"
              }
            </div>
          </div>

          <div className="flex flex-col w-full md:w-auto md:items-end gap-3">
            {isClockedIn && (
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note (optional)..."
                className="w-full md:w-56 h-8 px-3 bg-white/20 border border-white/30 rounded-lg text-sm text-white placeholder-white/60 focus:outline-none focus:bg-white/30"
              />
            )}
            {isClockedIn && (
              <div className="flex w-full md:w-auto items-center gap-2">
                {isPaused ? (
                  <button
                    type="button"
                    onClick={() => resumeMutation.mutate()}
                    disabled={resumeMutation.isPending || clockOutAction.isPending}
                    className="flex-1 md:flex-none h-11 sm:h-12 px-4 sm:px-5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 bg-white/20 text-white hover:bg-white/30 border border-white/40 transition-all disabled:opacity-50"
                  >
                    {resumeMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => pauseMutation.mutate()}
                    disabled={pauseMutation.isPending || clockOutAction.isPending}
                    className="flex-1 md:flex-none h-11 sm:h-12 px-4 sm:px-5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 bg-white/20 text-white hover:bg-white/30 border border-white/40 transition-all disabled:opacity-50"
                  >
                    {pauseMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Pause size={18} />}
                    Pause
                  </button>
                )}
                <button
                  onClick={() =>
                    clockOutAction.requestClockOut(currentSession!.startTime, note || undefined)
                  }
                  disabled={clockInMutation.isPending || clockOutAction.isPending}
                  className="flex-1 md:flex-none h-11 sm:h-12 px-4 sm:px-6 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all bg-white text-[#2563EB] hover:bg-blue-50 shadow-md disabled:opacity-50"
                >
                  {clockOutAction.isPending ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <><Square size={18} /> Clock Out</>
                  )}
                </button>
              </div>
            )}
            {!isClockedIn && (
              <button
                onClick={() => {
                  void runClockInWithLocation(
                    (input) => clockInMutation.mutateAsync(input),
                    {
                      isLocationRequired: async () =>
                        (await utils.location.clockInPolicy.fetch()).required,
                    },
                  );
                }}
                disabled={clockInMutation.isPending || clockOutAction.isPending}
                className="w-full md:w-auto h-11 sm:h-12 px-6 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all bg-white/20 text-white hover:bg-white/30 border border-white/40 disabled:opacity-50"
              >
                {clockInMutation.isPending ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <><Play size={18} /> {hasWorkedToday ? "Clock In Again" : "Clock In"}</>
                )}
              </button>
            )}
          </div>
        </div>

        {isClockedIn ? (
          <div className="mt-4 pt-4 border-t border-white/20 max-w-xl">
            <ManualClockInRequestForm
              variant="dark"
              sessionStartTime={currentSession!.startTime}
              clockInRequest={currentSession?.clockInRequest}
              pendingRequest={currentSession?.pendingClockInRequest}
              onSuccess={() => {
                utils.timeEntry.getCurrentSession.invalidate();
                utils.timeEntry.getStats.invalidate();
                utils.timeEntry.listPendingApprovals.invalidate();
              }}
            />
          </div>
        ) : null}
      </motion.div>

      {/* Stats Grid */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ProgressCard
          label="This Week"
          workedSeconds={weekWorked.workedSeconds}
          required={weekRequiredHours}
          overtimeSeconds={weekWorked.overtimeSeconds}
          icon={Timer}
          sub={`${formatPreciseWorkedTime(weekWorked.regularSeconds)} regular of ${weekRequiredHours}h`}
        />
        <ProgressCard
          label="Today"
          workedSeconds={todayWorked.workedSeconds}
          required={todayRequiredHours}
          overtimeSeconds={todayWorked.overtimeSeconds}
          icon={TrendingUp}
          sub={`${formatPreciseWorkedTime(todayWorked.regularSeconds)} regular of ${todayRequiredHours}h`}
        />
        <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={18} className="text-amber-500" />
            <span className="text-xs font-medium text-gray-500">Overtime Summary</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Week OT</span>
              <span className="font-semibold text-amber-600">
                {weekWorked.overtimeSeconds > 0
                  ? formatPreciseWorkedTime(weekWorked.overtimeSeconds)
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Today OT</span>
              <span className="font-semibold text-amber-600">
                {todayWorked.overtimeSeconds > 0
                  ? formatPreciseWorkedTime(todayWorked.overtimeSeconds)
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm border-t border-gray-100 pt-2">
              <span className="text-gray-500">Status</span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-[#1F2937]">
                <Clock size={14} className="text-gray-400" />
                {isClockedIn ? (isPaused ? "On break" : "Clocked in") : "Not clocked in"}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div variants={itemVariants}>
        <BreaksPanel date={localDateKey(new Date())} />
      </motion.div>

      {/* Daily Breakdown — full width */}
      <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-[#1F2937]">Daily Breakdown</h2>
            <p className="text-xs text-gray-400 mt-0.5">{breakdownSubtitle}</p>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 self-start sm:self-auto">
            {(["week", "month"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  period === p ? "bg-white text-[#2563EB] shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {p === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          {statsLoading && !isPlaceholderData && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 rounded-lg">
              <Loader2 size={20} className="animate-spin text-[#2563EB]" />
            </div>
          )}
          {chartData.length === 0 ? (
            <div className="h-[248px] flex items-center justify-center text-sm text-gray-400">
              No hours logged for this {period}
            </div>
          ) : (
            <DailyBreakdownChart
              key={`${period}-${chartData.length}`}
              data={chartData}
              period={period}
            />
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-sm">
          <span className="text-gray-500">{periodSummaryLabel}</span>
          <div className="text-right">
            <span className="font-semibold text-[#1F2937]">
              {formatHoursMinutesFloored(periodWorkedSeconds)}
            </span>
            {period === "week" && (
              <span className="text-gray-400"> / {periodWeekRequired}h</span>
            )}
            {period === "month" && monthOtHours > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">
                OT {formatHoursMinutes(monthOtHours)}
              </span>
            )}
            {period === "week" && periodOvertime > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">
                OT {formatHoursMinutes(periodOvertime)}
              </span>
            )}
          </div>
        </div>

        {listDays.length > 0 ? (
          <div className="mt-4 space-y-2 max-h-56 overflow-y-auto scrollbar-thin border-t border-gray-100 pt-4">
            {listDays.map((day) => (
              <div
                key={day.date}
                className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50"
              >
                <span className="text-gray-600">
                  {formatWorkZoneDateKey(day.date, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">
                    {formatHoursMinutes(day.regularHours)} regular
                  </span>
                  {day.overtimeHours > 0 ? (
                    <span className="font-semibold text-amber-600">
                      +{formatHoursMinutes(day.overtimeHours)} OT
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                  <span className="font-semibold text-[#1F2937] w-16 text-right">
                    {formatHoursMinutes(day.minutes / 60)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 text-center text-xs text-gray-400 py-4 border-t border-gray-100">
            No hours logged for this {period}
          </div>
        )}

        <DayHoursSection />
      </motion.div>
        </>
      ) : (
        <motion.div variants={itemVariants} className="bg-white border border-gray-200 rounded-xl p-5">
          <DayHoursSection embedded={false} />
        </motion.div>
      )}

      {isAdmin || isHR ? (
        <motion.div variants={itemVariants}>
          <TimeApprovalPanel />
        </motion.div>
      ) : null}

      {!hidePersonalTime && currentSession?.active ? (
        <CrossDayClockOutDialog
          open={clockOutAction.dialogOpen}
          onOpenChange={clockOutAction.setDialogOpen}
          sessionStartTime={currentSession.startTime}
          isPending={clockOutAction.isPending}
          onConfirmNow={clockOutAction.confirmClockOutNow}
          onUpdateTime={clockOutAction.updateClockOutTime}
        />
      ) : null}
    </motion.div>
  );
}
