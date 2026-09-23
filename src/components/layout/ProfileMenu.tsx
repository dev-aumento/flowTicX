import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useLiveSessionTimers } from "@/hooks/useLiveSessionTimers";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { trpc } from "@/providers/trpc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { invalidateActiveTaskTimers } from "@/lib/invalidate-task-timers";
import { ManualClockInRequestForm } from "@/components/time-tracking/ManualClockInRequestForm";
import { CrossDayClockOutDialog } from "@/components/time-tracking/CrossDayClockOutDialog";
import { useClockOutAction } from "@/hooks/useClockOutAction";
import { formatElapsedHMS, roleConfig } from "@/lib/utils";
import { isAdminOrManagement } from "@/lib/leave-policy";
import { isClientPortalUser } from "@/lib/client-portal";
import { runClockInWithLocation } from "@/lib/clock-in-with-location";
import { toast } from "sonner";
import {
  ChevronRight,
  Loader2,
  LogOut,
  Pause,
  Play,
  Power,
  Timer,
} from "lucide-react";

function userPositionOrDepartment(user: {
  position?: string | null;
  department?: string | null;
} | null | undefined) {
  const position = user?.position?.trim();
  if (position) return position;
  const department = user?.department?.trim();
  if (department) return department;
  return null;
}

export function ProfileMenu({
  variant = "default",
}: {
  variant?: "default" | "admin" | "client";
}) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const admin = variant === "admin" || variant === "client";
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const hidePersonalTime = isAdminOrManagement(user) || isClientPortalUser(user);

  const { data: todayStats } = trpc.timeEntry.getStats.useQuery(
    { period: "today" },
    { enabled: open && !hidePersonalTime, staleTime: 30_000 },
  );
  const hasWorkedToday = (todayStats?.totalSeconds ?? 0) > 0;

  const { data: currentSession, refetch: refetchSession } = trpc.timeEntry.getCurrentSession.useQuery(
    undefined,
    {
      staleTime: 30_000,
      // Dot indicator needs session even when closed; poll only while menu is open.
      enabled: !hidePersonalTime,
      refetchInterval: hidePersonalTime ? false : open ? 30_000 : false,
    },
  );

  const isClockedIn = !!currentSession?.active;
  const isPaused = !!currentSession?.paused;
  const { workSeconds, breakSeconds } = useLiveSessionTimers(
    isClockedIn ? currentSession : null,
  );
  const priorWorkSeconds = currentSession?.priorDayWorkSeconds ?? 0;
  const cumulativeWorkSeconds = priorWorkSeconds + workSeconds;

  const invalidateTime = () => {
    utils.timeEntry.getCurrentSession.invalidate();
    utils.timeEntry.getStats.invalidate();
    utils.timeEntry.getBreaks.invalidate();
    utils.timeEntry.list.invalidate();
    utils.timeEntry.listPendingApprovals.invalidate();
    utils.dashboard.getStats.invalidate();
    utils.notification.list.invalidate();
    invalidateActiveTaskTimers(utils);
  };

  const clockOutAction = useClockOutAction(() => {
    invalidateTime();
    refetchSession();
  });

  const clockInMutation = trpc.timeEntry.clockIn.useMutation({
    onSuccess: () => {
      invalidateTime();
      refetchSession();
    },
    onError: (err) => toast.error(err.message || "Could not clock in"),
  });

  const pauseMutation = trpc.timeEntry.pauseSession.useMutation({
    onSuccess: () => {
      invalidateTime();
      refetchSession();
    },
  });

  const resumeMutation = trpc.timeEntry.resumeSession.useMutation({
    onSuccess: () => {
      invalidateTime();
      refetchSession();
    },
  });

  const isBusy =
    clockInMutation.isPending ||
    clockOutAction.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending;

  const roleLabel = user?.role
    ? roleConfig[user.role as keyof typeof roleConfig]?.label ?? "Employee"
    : "Employee";
  const clientPortal = isClientPortalUser(user);
  const subtitle = clientPortal
    ? user?.email?.trim() || null
    : userPositionOrDepartment(user);
  const adminRoleLabel =
    variant === "client"
      ? "Client Portal"
      : user?.role === "admin"
        ? "Super Admin"
        : roleLabel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            admin
              ? "flex items-center gap-2.5 pl-1 pr-1 py-1 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
              : "flex items-center gap-3 pl-1 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors pr-1 py-1"
          }
        >
          {admin ? (
            <>
              <div className="relative">
                <UserAvatar name={user?.name} avatar={user?.avatar} size={36} />
              </div>
              <div className="text-left hidden md:block min-w-0">
                <div className="text-sm font-medium text-[#1F2937] dark:text-white leading-tight truncate max-w-[140px]">
                  {user?.name || "User"}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{adminRoleLabel}</div>
              </div>
            </>
          ) : (
            <div className="text-right hidden md:block">
              <div className="text-sm font-medium text-gray-900 dark:text-white leading-tight">{user?.name || "User"}</div>
              {subtitle ? (
                <div className="text-xs text-gray-500 truncate">{subtitle}</div>
              ) : null}
            </div>
          )}
          {admin ? null : (
            <div className="relative">
              <UserAvatar name={user?.name} avatar={user?.avatar} size={36} />
              {!hidePersonalTime && isClockedIn && (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                    isPaused ? "bg-amber-400" : "bg-emerald-500"
                  }`}
                />
              )}
            </div>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[320px] p-0 rounded-2xl border-gray-200 shadow-xl overflow-hidden">
        {/* Profile header */}
        <div className="w-full flex items-center gap-3 p-4 text-left">
          <UserAvatar name={user?.name} avatar={user?.avatar} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold text-gray-900 truncate">{user?.name || "User"}</span>
            </div>
            <div className="text-xs text-gray-500 truncate">{subtitle ?? "Team member"}</div>
            <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-[#2563EB]">
              {roleLabel}
            </span>
          </div>
        </div>

        {/* Time tracking card — hidden for admin / management */}
        {!hidePersonalTime ? (
        <div className="mx-4 mb-4 rounded-xl border border-gray-200 bg-white overflow-hidden">
          {isClockedIn ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("/time-tracking");
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-100"
              >
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">
                    {isPaused ? "On break" : "Clocked in"}
                    <span className="text-gray-300 mx-1.5">|</span>
                    <span className="font-mono font-semibold text-gray-900">
                      {formatElapsedHMS(isPaused ? breakSeconds : cumulativeWorkSeconds)}
                    </span>
                  </div>
                  {!isPaused && breakSeconds > 0 && (
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      Work time: {formatElapsedHMS(cumulativeWorkSeconds)}
                    </div>
                  )}
                  {isPaused && (
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      Work paused at {formatElapsedHMS(cumulativeWorkSeconds)}
                    </div>
                  )}
                </div>
                <ChevronRight size={16} className="text-gray-400 shrink-0" />
              </button>

              <div className="flex gap-2 p-2">
                {isPaused ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => resumeMutation.mutate()}
                    className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg border border-[#2563EB] text-[#2563EB] text-sm font-medium hover:bg-blue-50 transition-colors disabled:opacity-50"
                  >
                    {resumeMutation.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => pauseMutation.mutate()}
                    className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg border border-[#2563EB] text-[#2563EB] text-sm font-medium hover:bg-blue-50 transition-colors disabled:opacity-50"
                  >
                    {pauseMutation.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Pause size={14} />
                    )}
                    Pause
                  </button>
                )}

                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => clockOutAction.requestClockOut(currentSession!.startTime)}
                  className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
                >
                  {clockOutAction.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Power size={14} />
                  )}
                  Clock out
                </button>
              </div>

              <div className="px-2 pb-2">
                <ManualClockInRequestForm
                  sessionStartTime={currentSession!.startTime}
                  clockInRequest={currentSession?.clockInRequest}
                  pendingRequest={currentSession?.pendingClockInRequest}
                  onSuccess={invalidateTime}
                />
              </div>
            </>
          ) : (
            <div className="p-3">
              <p className="text-xs text-gray-500 mb-2">
                {hasWorkedToday ? "Continue tracking for today" : "You are not clocked in"}
              </p>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  void runClockInWithLocation(
                    (input) => clockInMutation.mutateAsync(input),
                    {
                      isLocationRequired: async () =>
                        (await utils.location.clockInPolicy.fetch()).required,
                    },
                  );
                }}
                className="w-full h-9 flex items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
              >
                {clockInMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                {hasWorkedToday ? "Clock in again" : "Clock in"}
              </button>
            </div>
          )}
        </div>
        ) : null}

        {variant !== "client" ? (
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate("/time-tracking");
          }}
          className="mx-4 mb-4 w-[calc(100%-2rem)] flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <Timer size={16} className="text-gray-400" />
            {hidePersonalTime ? "Employee Hours" : "Time Tracking"}
          </span>
          <ChevronRight size={16} className="text-gray-400 shrink-0" />
        </button>
        ) : null}
      </PopoverContent>

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
    </Popover>
  );
}
