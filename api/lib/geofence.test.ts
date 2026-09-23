import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  effectiveGeofenceRadiusMeters,
  findMatchingGeofence,
  GEOFENCE_EXIT_HYSTERESIS_M,
  GEOFENCE_MIN_ACCURACY_BUFFER_M,
  isWithinGeofence,
} from "@/lib/geofence";

const office = {
  id: 1,
  name: "HQ",
  latitude: 23.033863,
  longitude: 72.546768,
  radiusMeters: 100,
};

describe("geofence matching", () => {
  it("computes near-zero distance for the same point", () => {
    expect(
      distanceMeters(
        office.latitude,
        office.longitude,
        office.latitude,
        office.longitude,
      ),
    ).toBeLessThan(0.5);
  });

  it("treats the office pin as inside with the default accuracy buffer", () => {
    expect(
      isWithinGeofence(office.latitude, office.longitude, office, {
        mode: "enter",
      }),
    ).toBe(true);
  });

  it("allows GPS jitter just outside the configured radius on enter", () => {
    // ~120 m north of the pin — outside 100 m raw radius, inside 100 + 60 buffer
    const near = {
      lat: office.latitude + 0.00108,
      lng: office.longitude,
    };
    const d = distanceMeters(
      near.lat,
      near.lng,
      office.latitude,
      office.longitude,
    );
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(100 + GEOFENCE_MIN_ACCURACY_BUFFER_M);

    expect(
      findMatchingGeofence(near.lat, near.lng, [office], { mode: "enter" }),
    ).not.toBeNull();
  });

  it("requires extra distance before exit matching fails", () => {
    const enterLimit = effectiveGeofenceRadiusMeters(office.radiusMeters, {
      mode: "enter",
      accuracyMeters: 40,
    });
    const exitLimit = effectiveGeofenceRadiusMeters(office.radiusMeters, {
      mode: "exit",
      accuracyMeters: 40,
    });
    expect(exitLimit).toBe(enterLimit + GEOFENCE_EXIT_HYSTERESIS_M);
  });

  it("uses reported accuracy when larger than the minimum buffer", () => {
    expect(
      effectiveGeofenceRadiusMeters(100, {
        mode: "enter",
        accuracyMeters: 90,
      }),
    ).toBe(190);
  });
});
