export type PositionCoords = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
};

export type PositionWatchHandle = {
  clear: () => void | Promise<void>;
};

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

export function getClockInPositionCoords(): Promise<PositionCoords> {
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
