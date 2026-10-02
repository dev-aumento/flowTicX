import { describe, expect, it } from "vitest";
import { noticePeriodEndsAt } from "@/lib/notice-period";
import { endOfWorkZoneDay, startOfWorkZoneDay, workZoneDateKey } from "@/lib/timezone";

describe("noticePeriodEndsAt", () => {
  it("counts today as day 1 and ends at the close of the last day", () => {
    const from = new Date("2026-10-02T08:00:00.000Z");
    const end = noticePeriodEndsAt(1, from);
    expect(workZoneDateKey(end)).toBe(workZoneDateKey(from));
    expect(end.getTime()).toBe(endOfWorkZoneDay(from).getTime());
  });

  it("includes the full last day of a multi-day notice", () => {
    const from = new Date("2026-10-02T08:00:00.000Z");
    const end = noticePeriodEndsAt(30, from);
    const lastDay = new Date(startOfWorkZoneDay(from).getTime() + 29 * 24 * 60 * 60 * 1000);
    expect(workZoneDateKey(end)).toBe(workZoneDateKey(lastDay));
    expect(end.getTime()).toBe(endOfWorkZoneDay(lastDay).getTime());
  });
});
