import { describe, expect, it } from "vitest";
import { isFreePlan, sampleProjectCount } from "./sample-workspace";

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
