import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import {
  findMatchingGeofence,
  GEOFENCE_MAX_USABLE_ACCURACY_M,
} from "@/lib/geofence";
import {
  watchPositionCoords,
  type PositionWatchHandle,
} from "@/lib/device-location";
import { invalidateActiveTaskTimers } from "@/lib/invalidate-task-timers";

/** Consecutive outside-radius samples before auto clock-out (GPS jitter buffer). */
const OUTSIDE_STREAK_REQUIRED = 6;

/** Minimum time spent outside before auto clock-out (ms). */
const OUTSIDE_DURATION_MS = 45_000;

const GEOFENCE_EXIT_NOTE = "Auto clock-out: left work location";

/**
 * While clocked in, watch GPS and clock out when the user leaves all *active*
 * work-location radii. Archived locations and WFH / no-geofence days are skipped.
 */
export function useGeofenceAutoClockOut() {
  const utils = trpc.useUtils();
  const outsideStreakRef = useRef(0);
  const outsideSinceRef = useRef<number | null>(null);
  const clockingOutRef = useRef(false);
  const watchRef = useRef<PositionWatchHandle | null>(null);

  const { data: currentSession } = trpc.timeEntry.getCurrentSession.useQuery(
    undefined,
    { refetchInterval: 60_000 },
  );
  const isClockedIn = !!currentSession?.active;

  const { data: policy } = trpc.location.clockInPolicy.useQuery(undefined, {
    enabled: isClockedIn,
    staleTime: 30_000,
    refetchInterval: isClockedIn ? 60_000 : false,
  });

  const monitorEnabled =
    isClockedIn && policy?.required === true && policy.reason === "geofence";

  const { data: locations = [] } = trpc.location.listActiveForClockIn.useQuery(
    undefined,
    {
      enabled: monitorEnabled,
      staleTime: 30_000,
      refetchInterval: monitorEnabled ? 60_000 : false,
    },
  );

  const clockOutMutation = trpc.timeEntry.clockOut.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.timeEntry.getCurrentSession.invalidate(),
        utils.timeEntry.getStats.invalidate(),
        utils.timeEntry.getDayHours.invalidate(),
        utils.timeEntry.getTeamHours.invalidate(),
        utils.timeEntry.getBreaks.invalidate(),
        utils.dashboard.getStats.invalidate(),
      ]);
      invalidateActiveTaskTimers(utils);
      toast.message("You were clocked out after leaving the work location.");
    },
    onSettled: () => {
      clockingOutRef.current = false;
      outsideStreakRef.current = 0;
      outsideSinceRef.current = null;
    },
  });

  useEffect(() => {
    let cancelled = false;

    const stopWatch = async () => {
      const handle = watchRef.current;
      watchRef.current = null;
      if (handle) {
        try {
          await handle.clear();
        } catch {
          // ignore clear errors
        }
      }
    };

    if (!monitorEnabled || locations.length === 0) {
      outsideStreakRef.current = 0;
      outsideSinceRef.current = null;
      void stopWatch();
      return;
    }

    void (async () => {
      try {
        const handle = await watchPositionCoords(
          (coords) => {
            if (cancelled || clockingOutRef.current) return;

            // Unreliable coarse/network fixes must not trigger clock-out.
            if (
              coords.accuracyMeters != null &&
              coords.accuracyMeters > GEOFENCE_MAX_USABLE_ACCURACY_M
            ) {
              return;
            }

            const match = findMatchingGeofence(
              coords.latitude,
              coords.longitude,
              locations,
              {
                accuracyMeters: coords.accuracyMeters,
                mode: "exit",
              },
            );

            if (match) {
              outsideStreakRef.current = 0;
              outsideSinceRef.current = null;
              return;
            }

            const now = Date.now();
            if (outsideSinceRef.current == null) {
              outsideSinceRef.current = now;
            }
            outsideStreakRef.current += 1;

            const outsideLongEnough =
              now - (outsideSinceRef.current ?? now) >= OUTSIDE_DURATION_MS;
            if (
              outsideStreakRef.current < OUTSIDE_STREAK_REQUIRED ||
              !outsideLongEnough
            ) {
              return;
            }

            clockingOutRef.current = true;
            outsideStreakRef.current = 0;
            outsideSinceRef.current = null;
            clockOutMutation.mutate({ note: GEOFENCE_EXIT_NOTE });
            void stopWatch();
          },
          () => {
            // Permission / temporary GPS errors — keep watching; do not clock out.
            outsideStreakRef.current = 0;
            outsideSinceRef.current = null;
          },
          {
            enableHighAccuracy: true,
            maximumAge: 5_000,
            timeout: 20_000,
          },
        );

        if (cancelled) {
          await handle.clear();
          return;
        }
        watchRef.current = handle;
      } catch {
        // Cannot start watch (e.g. permission denied) — leave session running.
      }
    })();

    return () => {
      cancelled = true;
      void stopWatch();
    };
    // clockOutMutation.mutate is stable enough; depend on locations identity via length + ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    monitorEnabled,
    locations.map((l) => `${l.id}:${l.radiusMeters}:${l.latitude}:${l.longitude}`).join("|"),
  ]);
}

/** Mount once under authenticated app shells. */
export function GeofenceAutoClockOut() {
  useGeofenceAutoClockOut();
  return null;
}
