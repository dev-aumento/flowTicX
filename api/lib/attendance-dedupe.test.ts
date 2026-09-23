import { describe, expect, it } from "vitest";
import { filterMeaningfulAttendanceEntries } from "../../src/lib/work-hours-policy";

describe("filterMeaningfulAttendanceEntries", () => {
  it("keeps a single clean day entry", () => {
    const entries = [
      {
        id: 1,
        clockIn: new Date("2026-07-23T04:41:00.000Z"),
        clockOut: new Date("2026-07-23T13:54:00.000Z"),
        note: "Clocked in",
      },
    ];
    expect(filterMeaningfulAttendanceEntries(entries)).toHaveLength(1);
  });

  it("drops zero-span and overlapping junk fragments", () => {
    const entries = [
      {
        id: 1,
        clockIn: new Date("2026-07-23T04:41:00.000Z"),
        clockOut: new Date("2026-07-23T13:54:00.000Z"),
        note: "Clocked in",
      },
      {
        id: 2,
        clockIn: new Date("2026-07-23T13:53:00.000Z"),
        clockOut: new Date("2026-07-23T13:54:00.000Z"),
        note: "Clocked in — Forget to clockout.",
      },
      {
        id: 3,
        clockIn: new Date("2026-07-23T13:55:00.000Z"),
        clockOut: new Date("2026-07-23T13:55:00.000Z"),
        note: "Clocked in",
      },
    ];

    const kept = filterMeaningfulAttendanceEntries(entries);
    expect(kept.map((e) => e.id)).toEqual([1]);
  });

  it("preserves legitimate non-overlapping re-clocks", () => {
    const entries = [
      {
        id: 1,
        clockIn: new Date("2026-07-23T04:00:00.000Z"),
        clockOut: new Date("2026-07-23T08:00:00.000Z"),
        note: "Clocked in",
      },
      {
        id: 2,
        clockIn: new Date("2026-07-23T09:00:00.000Z"),
        clockOut: new Date("2026-07-23T13:00:00.000Z"),
        note: "Clocked in",
      },
    ];

    const kept = filterMeaningfulAttendanceEntries(entries);
    expect(kept.map((e) => e.id)).toEqual([1, 2]);
  });

  it("drops duplicate-cleanup marker rows", () => {
    const entries = [
      {
        id: 1,
        clockIn: new Date("2026-07-23T04:00:00.000Z"),
        clockOut: new Date("2026-07-23T12:00:00.000Z"),
        note: "Clocked in",
      },
      {
        id: 2,
        clockIn: new Date("2026-07-23T12:00:00.000Z"),
        clockOut: new Date("2026-07-23T12:01:00.000Z"),
        note: "Clocked in - Duplicate open entry closed",
      },
    ];

    const kept = filterMeaningfulAttendanceEntries(entries);
    expect(kept.map((e) => e.id)).toEqual([1]);
  });
});
