import { toast } from "sonner";
import { getClockInPositionCoords } from "@/lib/device-location";

type ClockInInput = {
  note?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
};

type ClockInOptions = {
  note?: string;
  /**
   * When false, skip GPS (e.g. approved WFH today, or no geofences).
   * Defaults to true when omitted.
   */
  isLocationRequired?: () => boolean | Promise<boolean>;
};

/**
 * Resolve GPS coords then call the clock-in mutation.
 * Shows a toast when location access fails.
 * Skips GPS when `isLocationRequired` resolves to false (WFH / no geofences).
 */
export async function runClockInWithLocation(
  mutateAsync: (input?: ClockInInput) => Promise<unknown>,
  options?: ClockInOptions,
) {
  try {
    const requireLocation = options?.isLocationRequired
      ? await options.isLocationRequired()
      : true;

    if (!requireLocation) {
      return await mutateAsync({ note: options?.note });
    }

    const coords = await getClockInPositionCoords();
    return await mutateAsync({
      note: options?.note,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracyMeters: coords.accuracyMeters,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Could not clock in. Check your location and try again.";
    toast.error(message);
    throw err;
  }
}
