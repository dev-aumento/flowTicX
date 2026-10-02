import { describe, expect, it } from "vitest";
import { isFreeTierPlan, planDaysRemaining, planExpiryWarning } from "./plan-expiry";

describe("plan expiry warning", () => {
  it("treats trial and free as the free tier", () => {
    expect(isFreeTierPlan("trial")).toBe(true);
    expect(isFreeTierPlan("free")).toBe(true);
    expect(isFreeTierPlan("enterprise")).toBe(false);
  });

  it("counts remaining days through the end of the expiry date", () => {
    const now = new Date(2026, 9, 3, 0, 0, 0);
    const expires = new Date(2026, 9, 9, 15, 0, 0);
    expect(planDaysRemaining(expires, now)).toBe(7);
  });

  it("warns only during the last 7 days", () => {
    expect(planExpiryWarning(8)).toBeNull();
    expect(planExpiryWarning(7)).toBe(
      "Your plan will be expired in 7 days. Upgrade your plan to continue use aaso",
    );
    expect(planExpiryWarning(1)).toBe(
      "Your plan will be expired in 1 day. Upgrade your plan to continue use aaso",
    );
    expect(planExpiryWarning(0)).toBeNull();
  });
});
