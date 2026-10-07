import { describe, expect, it } from "vitest";
import { isFreePlan, sampleEmployeeCount, sampleProjectCount, sampleWorkdayKeys } from "./sample-workspace";

describe("sampleProjectCount", () => {
  it("caps the free and trial plans at 3 projects", () => {
    expect(isFreePlan("trial")).toBe(true);
    expect(isFreePlan("free")).toBe(true);
    expect(sampleProjectCount("trial", 3)).toBe(3);
    expect(sampleProjectCount("free", 3)).toBe(3);
    expect(sampleProjectCount("free", 2)).toBe(2);
  });

  it("uses five sample projects on paid plans, still inside a numeric cap", () => {
    expect(sampleProjectCount("starter", null)).toBe(5);
    expect(sampleProjectCount("growth", null)).toBe(5);
    expect(sampleProjectCount("business", null)).toBe(5);
    expect(sampleProjectCount("enterprise", null)).toBe(5);
    expect(sampleProjectCount("starter", 4)).toBe(4);
  });
});

describe("sampleEmployeeCount", () => {
  it("adds four starter employees when the plan has room", () => {
    expect(sampleEmployeeCount(null)).toBe(4);
    expect(sampleEmployeeCount(undefined)).toBe(4);
    expect(sampleEmployeeCount(100)).toBe(4);
  });

  it("stays inside the seats left after the admin", () => {
    expect(sampleEmployeeCount(2)).toBe(2);
    expect(sampleEmployeeCount(1)).toBe(1);
    expect(sampleEmployeeCount(0)).toBe(0);
    expect(sampleEmployeeCount(-3)).toBe(0);
  });
});

describe("sampleWorkdayKeys", () => {
  it("lists recent weekdays before today", () => {
    const today = new Date("2026-10-07T04:00:00.000Z");
    expect(sampleWorkdayKeys(today, 8)).toEqual([
      "2026-09-25",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-05",
      "2026-10-06",
    ]);
  });
});
