import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLiveSessionTimers } from "@/hooks/useLiveSessionTimers";
import { formatElapsedHMS } from "@/lib/utils";
import {
  formatPreciseWorkedClock,
  localDateKey,
  workedSecondsFromStats,
} from "@/lib/work-hours-policy";
import { formatWorkZoneDate, istTimeOfDayGreeting } from "@/lib/timezone";
import {
  Clock, CheckCircle2, Timer,
  Play, Square, Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import { CrossDayClockOutDialog } from "@/components/time-tracking/CrossDayClockOutDialog";
import { useClockOutAction } from "@/hooks/useClockOutAction";
import {
  dashboardQueryOptions,
  DASHBOARD_REFRESH_EVENT,
  refreshDashboardPage,
} from "@/lib/dashboard-refresh";
import { isHrRoleOnly, isAdminOrManagement, isFinanceRoleOnly } from "@/lib/leave-policy";
import { isClientPortalUser } from "@/lib/client-portal";
import { HrDashboard } from "@/components/dashboard/HrDashboard";
import { FinanceDashboard } from "@/components/dashboard/FinanceDashboard";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";
import { ClientDashboard } from "@/components/dashboard/ClientDashboard";
import { LeaveSummaryPanel } from "@/components/dashboard/LeaveSummaryPanel";
import { UpcomingBirthdaysPanel, TodayBirthdaysBanner } from "@/components/dashboard/UpcomingBirthdaysPanel";
import { DashboardMyTasksPanel } from "@/components/dashboard/DashboardMyTasksPanel";
import { DashboardCurrentTimerCard } from "@/components/dashboard/DashboardCurrentTimerCard";
import { DashboardInsightCards } from "@/components/dashboard/DashboardInsightCards";
import { DashboardCalendarPanel } from "@/components/dashboard/DashboardCalendarPanel";
import { runClockInWithLocation } from "@/lib/clock-in-with-location";
import { toast } from "sonner";
import { useTaskStatusLabels } from "@/hooks/useTaskStatusLabels";
import { hasPlanFeature } from "@/lib/plan-features";

export default function Dashboard() {
  const { user } = useAuth();

  if (isFinanceRoleOnly(user)) {
    return <FinanceDashboard />;
  }

  if (isClientPortalUser(user)) {
    return <ClientDashboard />;
  }

  if (isHrRoleOnly(user)) {
    return <HrDashboard />;
  }

  if (isAdminOrManagement(user)) {
    return <AdminDashboard />;
  }

  return <EmployeeDashboard />;
}

function EmployeeDashboard() {
  const { user } = useAuth();
  const isManager = String(user?.role ?? "").toLowerCase() === "manager";
  const showTasks = hasPlanFeature(user, "tasks");
  const showTime = hasPlanFeature(user, "time_tracking");
  const showLeave = hasPlanFeature(user, "leave");
  const statusLabels = useTaskStatusLabels();

  const { data: stats } = trpc.dashboard.getStats.useQuery(undefined, {
    ...dashboardQueryOptions,
  });
  const { data: todayStats } = trpc.timeEntry.getStats.useQuery(
    { period: "today" },
    { ...dashboardQueryOptions },
  );
  const { data: weekStats } = trpc.timeEntry.getStats.useQuery(
    { period: "week" },
    { ...dashboardQueryOptions },
  );
  const { data: leaveSummary } = trpc.dashboard.getLeaveSummary.useQuery(
    undefined,
    { ...dashboardQueryOptions },
  );
  const { data: monthAttendance, isLoading: monthAttendanceLoading } =
    trpc.timeEntry.getMonthAttendance.useQuery(undefined, {
      ...dashboardQueryOptions,
    });
  const { data: currentSession } = trpc.timeEntry.getCurrentSession.useQuery(
    undefined,
    { ...dashboardQueryOptions },
  );
  const utils = trpc.useUtils();

  useEffect(() => {
    const onRefresh = () => {
      void refreshDashboardPage(utils);
    };
    window.addEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
  }, [utils]);

  const invalidateTimeStats = () => {
    void refreshDashboardPage(utils);
  };

  const clockOutAction = useClockOutAction(invalidateTimeStats);

  const clockInMutation = trpc.timeEntry.clockIn.useMutation({
    onSuccess: invalidateTimeStats,
    onError: (err) => toast.error(err.message || "Could not clock in"),
  });

  const isClockedIn = !!currentSession?.active;
  const isPaused = !!currentSession?.paused;
  const { workSeconds } = useLiveSessionTimers(isClockedIn ? currentSession : null);
  const priorWorkSeconds = currentSession?.priorDayWorkSeconds ?? 0;
  const cumulativeWorkSeconds = priorWorkSeconds + workSeconds;
  const hasWorkedToday = (todayStats?.totalSeconds ?? 0) > 0;

  const todayKey = localDateKey(new Date());
  const todayIncludeLive =
    !!todayStats?.activeSession && todayStats.activeSession.date === todayKey;

  const todayTrackedSeconds = useMemo(
    () => workedSecondsFromStats(todayStats, workSeconds, todayIncludeLive),
    [todayStats, workSeconds, todayIncludeLive],
  );

  const weekTrackedSeconds = useMemo(
    () => workedSecondsFromStats(weekStats, workSeconds, isClockedIn),
    [weekStats, workSeconds, isClockedIn],
  );

  const completedTasksCard = {
    title: "Completed Tasks",
    value: stats?.completedTasks ?? 0,
    icon: CheckCircle2,
    iconColor: "#10B981",
    badge: { text: statusLabels.done, bg: "#D1FAE5", color: "#059669" },
    subtext: isManager
      ? "Tasks finished across the org"
      : "Tasks finished",
    mono: false,
  };

  const kpiCards = [
    ...(showTasks
      ? [
          {
            title: "Ongoing Tasks",
            value: stats?.ongoingTasks ?? 0,
            icon: Clock,
            iconColor: "#F59E0B",
            badge: { text: statusLabels.todo, bg: "#FEF3C7", color: "#D97706" },
            subtext: "Tasks awaiting action",
            mono: false,
          },
          ...(isManager ? [completedTasksCard] : []),
        ]
      : []),
    ...(showTime
      ? [
          {
            title: "Hours Logged Today",
            value: formatPreciseWorkedClock(todayTrackedSeconds),
            icon: Timer,
            iconColor: "#3B82F6",
            badge: { text: "Today", bg: "#DBEAFE", color: "#2563EB" },
            subtext: "Time logged today",
            mono: true,
          },
          {
            title: "Hours Logged This Week",
            value: formatPreciseWorkedClock(weekTrackedSeconds),
            icon: Timer,
            iconColor: "#0EA5E9",
            badge: { text: "This week", bg: "#E0F2FE", color: "#0284C7" },
            subtext: "Time logged this week",
            mono: true,
          },
        ]
      : []),
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } },
  };

  const greeting = useMemo(() => istTimeOfDayGreeting(new Date()), []);
  const firstName = user?.name?.split(" ")[0] || "there";

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold text-[#1F2937] whitespace-nowrap overflow-hidden text-ellipsis">
            {greeting}, {firstName}{" "}
            <span
              className="inline-block origin-[70%_70%] animate-wave"
              role="img"
              aria-label="waving hand"
            >
              👋
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1 w-full">
            {formatWorkZoneDate(new Date(), {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {showTime ? (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 shadow-sm w-full sm:w-auto">
          <div className="text-left sm:text-right w-full sm:w-auto">
            <div className="text-xs text-gray-500">
              {isClockedIn
                ? isPaused
                  ? "On break (work paused)"
                  : "Today's total"
                : hasWorkedToday
                  ? "Welcome back"
                  : "Ready to work?"}
            </div>
            {isClockedIn ? (
              <div className="text-xl font-bold text-[#1F2937] font-mono">
                {formatElapsedHMS(cumulativeWorkSeconds)}
              </div>
            ) : hasWorkedToday ? (
              <div className="text-sm font-semibold text-gray-600 font-mono">
                {formatPreciseWorkedClock(todayStats?.totalSeconds ?? 0)} logged today
              </div>
            ) : null}
          </div>
          <button
            onClick={() =>
              isClockedIn
                ? clockOutAction.requestClockOut(currentSession!.startTime)
                : void runClockInWithLocation(
                    (input) => clockInMutation.mutateAsync(input),
                    {
                      isLocationRequired: async () =>
                        (await utils.location.clockInPolicy.fetch()).required,
                    },
                  )
            }
            disabled={clockInMutation.isPending || clockOutAction.isPending}
            className={`h-10 px-5 rounded-lg font-semibold text-sm flex items-center gap-2 transition-all ${
              isClockedIn
                ? "bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 dark:!bg-transparent dark:text-[#58a6ff] dark:!border-[#58a6ff]/70 dark:hover:!bg-[#58a6ff]/10"
                : "bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white hover:shadow-lg hover:shadow-blue-200 dark:hover:shadow-none"
            }`}
          >
            {clockInMutation.isPending || clockOutAction.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isClockedIn ? (
              <>
                <Square size={16} /> Clock Out
              </>
            ) : (
              <>
                <Play size={16} /> {hasWorkedToday ? "Clock In Again" : "Clock In"}
              </>
            )}
          </button>
        </div>
        ) : null}
      </motion.div>

      <TodayBirthdaysBanner birthdays={leaveSummary?.upcomingBirthdays ?? []} />

      {kpiCards.length > 0 ? (
      <motion.div
        variants={itemVariants}
        className={`grid grid-cols-1 sm:grid-cols-2 gap-5 ${
          kpiCards.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"
        }`}
      >
        {kpiCards.map((card) => (
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
            <div
              className={`text-3xl font-bold text-[#1F2937] mb-1 ${
                card.mono ? "font-mono tracking-tight" : ""
              }`}
            >
              {card.value}
            </div>
            <div className="text-xs text-gray-500">{card.subtext}</div>
          </div>
        ))}
      </motion.div>
      ) : null}

      {showTasks || showTime ? (
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch"
      >
        {showTasks ? (
        <div className={showTime ? "xl:col-span-2 min-w-0 h-full" : "xl:col-span-3 min-w-0 h-full"}>
          <DashboardMyTasksPanel />
        </div>
        ) : null}
        {showTime ? (
        <div className={showTasks ? "min-w-0 h-full" : "xl:col-span-3 min-w-0 h-full"}>
          <DashboardCurrentTimerCard />
        </div>
        ) : null}
      </motion.div>
      ) : null}

      <motion.div variants={itemVariants}>
        <DashboardInsightCards
          attendance={monthAttendance}
          attendanceLoading={monthAttendanceLoading}
        />
      </motion.div>

      {showLeave ? (
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch"
      >
        <div className="xl:col-span-2 min-w-0 h-full">
          <LeaveSummaryPanel
            leaveMonthLabel={leaveSummary?.leaveMonthLabel}
            upcomingLeaves={leaveSummary?.upcomingLeaves ?? []}
            upcomingWfh={leaveSummary?.upcomingWfh ?? []}
            employeeView
            className="h-full"
          />
        </div>
        <div className="min-w-0 h-full">
          <UpcomingBirthdaysPanel
            birthdays={leaveSummary?.upcomingBirthdays ?? []}
            showViewAll={false}
          />
        </div>
      </motion.div>
      ) : null}

      {isManager ? (
        <motion.div variants={itemVariants}>
          <DashboardCalendarPanel />
        </motion.div>
      ) : null}

      {currentSession?.active ? (
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
