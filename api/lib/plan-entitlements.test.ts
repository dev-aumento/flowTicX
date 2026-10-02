import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENT_PRESETS, deriveFeatureKeys } from "@/lib/plan-entitlements";

describe("employee seats", () => {
  it("includes the employees module on every plan that allows team members", () => {
    for (const [slug, preset] of Object.entries(PLAN_ENTITLEMENT_PRESETS)) {
      const features = deriveFeatureKeys(preset.highlightKeys, preset.limits);
      expect(features, slug).toContain("employees");
    }
  });

  it("keeps advanced HR off the free plan", () => {
    const free = PLAN_ENTITLEMENT_PRESETS.free;
    const features = deriveFeatureKeys(free.highlightKeys, free.limits);
    expect(features).not.toContain("hr");
  });

  it("turns on advanced HR for business and enterprise", () => {
    const business = deriveFeatureKeys(
      PLAN_ENTITLEMENT_PRESETS.business.highlightKeys,
      PLAN_ENTITLEMENT_PRESETS.business.limits,
    );
    const enterprise = deriveFeatureKeys(
      PLAN_ENTITLEMENT_PRESETS.enterprise.highlightKeys,
      PLAN_ENTITLEMENT_PRESETS.enterprise.limits,
      [
        { slug: "business", highlightKeys: PLAN_ENTITLEMENT_PRESETS.business.highlightKeys },
        { slug: "growth", highlightKeys: PLAN_ENTITLEMENT_PRESETS.growth.highlightKeys },
        { slug: "starter", highlightKeys: PLAN_ENTITLEMENT_PRESETS.starter.highlightKeys },
      ],
    );
    expect(business).toContain("hr");
    expect(enterprise).toContain("hr");
    expect(enterprise).toContain("employees");
  });
});
