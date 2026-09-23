import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLiveSessionTimers } from "@/hooks/useLiveSessionTimers";
import { formatElapsedHMS } from "@/lib/utils";
import { formatPreciseWorkedClock } from "@/lib/work-hours-policy";
import { formatWorkZoneDate, istTimeOfDayGreeting } from "@/lib/timezone";
import {
  dashboardQueryOptions,
  DASHBOARD_REFRESH_EVENT,
  refreshDashboardPage,
} from "@/lib/dashboard-refresh";
import { CrossDayClockOutDialog } from "@/components/time-tracking/CrossDayClockOutDialog";
import { useClockOutAction } from "@/hooks/useClockOutAction";
import { WorkforceOverviewPanels } from "@/components/dashboard/WorkforceOverviewPanels";
import { WorkforceKpiCards } from "@/components/dashboard/WorkforceKpiCards";
import { TodayBirthdaysBanner } from "@/components/dashboard/UpcomingBirthdaysPanel";
import { motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import {
  Play,
  Square,
  Loader2,
} from "lucide-react";
import { runClockInWithLocation } from "@/lib/clock-in-with-location";
import { toast } from "sonner";

export function HrDashboard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const greeting = useMemo(() => istTimeOfDayGreeting(new Date()), []);
  const firstName = user?.name?.split(" ")[0] || "there";

  const { data, isLoading } = trpc.dashboard.getHrDashboard.useQuery(
    undefined,
    dashboardQueryOptions,
  );
  const { data: todayStats } = trpc.timeEntry.getStats.useQuery(
    { period: "today" },
    dashboardQueryOptions,
  );
  const { data: currentSession } = trpc.timeEntry.getCurrentSession.useQuery(
    undefined,
    dashboardQueryOptions,
  );

  useEffect(() => {
    const onRefresh = () => {
      void refreshDashboardPage(utils);
    };
    window.addEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
  }, [utils]);

  const invalidateTimeStats = () => {
    void refreshDashboardPage(utils);
    void utils.dashboard.getHrDashboard.invalidate();
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

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } },
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[#2563EB]" />
      </div>
    );
  }

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
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

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
            type="button"
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
                ? "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                : "bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white hover:shadow-lg hover:shadow-blue-200"
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
      </motion.div>

      <TodayBirthdaysBanner birthdays={data?.upcomingBirthdays ?? []} />

      <motion.div variants={itemVariants}>
        <WorkforceKpiCards data={data} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <WorkforceOverviewPanels data={data} />
      </motion.div>

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
