/** Earth radius in meters (mean). */
const EARTH_RADIUS_M = 6_371_000;

/**
 * Minimum GPS uncertainty allowance when checking geofences.
 * Indoor/mobile GPS is often ±30–80 m even when the user is on-site.
 */
export const GEOFENCE_MIN_ACCURACY_BUFFER_M = 60;

/**
 * Extra distance required beyond the enter radius before treating the user as
 * having left (hysteresis). Prevents flapping / false auto clock-outs.
 */
export const GEOFENCE_EXIT_HYSTERESIS_M = 50;

/** Ignore "outside" samples worse than this — likely network/coarse GPS. */
export const GEOFENCE_MAX_USABLE_ACCURACY_M = 150;

/** Convert degrees to radians. */
function toRad(degrees: number) {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two WGS84 points in meters (Haversine).
 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GeofenceLocation = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type GeofenceMatchOptions = {
  /** Reported GPS accuracy in meters (larger = less certain). */
  accuracyMeters?: number | null;
  /**
   * `enter` — clock-in / still inside (radius + accuracy buffer).
   * `exit` — left site (radius + accuracy + hysteresis).
   */
  mode?: "enter" | "exit";
};

/** Effective radius used for matching, including GPS uncertainty. */
export function effectiveGeofenceRadiusMeters(
  radiusMeters: number,
  options?: GeofenceMatchOptions,
): number {
  const accuracy =
    options?.accuracyMeters != null && Number.isFinite(options.accuracyMeters)
      ? Math.max(0, options.accuracyMeters)
      : 0;
  const buffer = Math.max(GEOFENCE_MIN_ACCURACY_BUFFER_M, accuracy);
  const hysteresis =
    options?.mode === "exit" ? GEOFENCE_EXIT_HYSTERESIS_M : 0;
  return radiusMeters + buffer + hysteresis;
}

/** True when the point is inside the circular geofence (with GPS buffer). */
export function isWithinGeofence(
  latitude: number,
  longitude: number,
  location: GeofenceLocation,
  options?: GeofenceMatchOptions,
): boolean {
  const d = distanceMeters(
    latitude,
    longitude,
    location.latitude,
    location.longitude,
  );
  return d <= effectiveGeofenceRadiusMeters(location.radiusMeters, options);
}

/**
 * Returns the nearest matching location within the effective radius, or null.
 */
export function findMatchingGeofence(
  latitude: number,
  longitude: number,
  locations: GeofenceLocation[],
  options?: GeofenceMatchOptions,
): { location: GeofenceLocation; distanceMeters: number } | null {
  let best: { location: GeofenceLocation; distanceMeters: number } | null = null;
  for (const location of locations) {
    const d = distanceMeters(
      latitude,
      longitude,
      location.latitude,
      location.longitude,
    );
    const limit = effectiveGeofenceRadiusMeters(location.radiusMeters, options);
    if (d <= limit && (!best || d < best.distanceMeters)) {
      best = { location, distanceMeters: d };
    }
  }
  return best;
}

export const LOCATION_RADIUS_OPTIONS = [
  { value: 50, label: "50 m" },
  { value: 100, label: "100 m" },
  { value: 150, label: "150 m" },
  { value: 200, label: "200 m" },
  { value: 300, label: "300 m" },
  { value: 500, label: "500 m" },
  { value: 1000, label: "1 km" },
  { value: 2000, label: "2 km" },
] as const;

export const DEFAULT_LOCATION_RADIUS_M = 100;

/** Default map center (Ahmedabad) when no saved locations exist. */
export const DEFAULT_MAP_CENTER = {
  lat: 23.033863,
  lng: 72.546768,
} as const;
