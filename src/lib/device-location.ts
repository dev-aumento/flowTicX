import { isNativeApp } from "@/lib/native-shell";

export type PositionCoords = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
};

export type PositionWatchHandle = {
  clear: () => void | Promise<void>;
};

async function readNativePosition(enableHighAccuracy: boolean, timeout: number, maximumAge: number) {
  const { Geolocation } = await import("@capacitor/geolocation");
  const permission = await Geolocation.requestPermissions();
  const allowed = permission.location === "granted" || permission.coarseLocation === "granted";
  if (!allowed) {
    throw new Error("Allow location access for AASO, then try again.");
  }
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy,
    timeout,
    maximumAge,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
  };
}

function requireGeolocation(): Geolocation {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("Location is not available in this browser.");
  }
  return navigator.geolocation;
}

function fromPosition(position: GeolocationPosition): PositionCoords {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: Number.isFinite(position.coords.accuracy)
      ? position.coords.accuracy
      : null,
  };
}

export async function getClockInPositionCoords(): Promise<PositionCoords> {
  if (isNativeApp()) {
    return readNativePosition(true, 20_000, 5_000);
  }

  const geo = requireGeolocation();
  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      (position) => resolve(fromPosition(position)),
      (error) =>
        reject(
          new Error(error.message || "Could not get location. Check browser permissions."),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
    );
  });
}

export async function watchPositionCoords(
  onSuccess: (coords: PositionCoords) => void,
  onError?: () => void,
  options?: PositionOptions,
): Promise<PositionWatchHandle> {
  if (isNativeApp()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    const permission = await Geolocation.requestPermissions();
    const allowed = permission.location === "granted" || permission.coarseLocation === "granted";
    if (!allowed) {
      onError?.();
      return { clear: () => undefined };
    }
    const watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: options?.enableHighAccuracy ?? true,
        timeout: options?.timeout ?? 20_000,
        maximumAge: options?.maximumAge ?? 5_000,
      },
      (position, error) => {
        if (error || !position) {
          onError?.();
          return;
        }
        onSuccess({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        });
      },
    );
    return {
      clear: () => Geolocation.clearWatch({ id: watchId }),
    };
  }

  const geo = requireGeolocation();
  const watchId = geo.watchPosition(
    (position) => onSuccess(fromPosition(position)),
    () => onError?.(),
    options,
  );
  return {
    clear: () => {
      geo.clearWatch(watchId);
    },
  };
}
