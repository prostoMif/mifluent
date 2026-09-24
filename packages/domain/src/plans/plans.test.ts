import { describe, expect, it } from "vitest";
import { resolvePlans } from "./plans.js";

describe("resolvePlans", () => {
  it("gives the free plan three targets by default", () => {
    const plans = resolvePlans();

    expect(plans.free.maxTargets).toBe(3);
  });

  it("applies an override from the environment", () => {
    const plans = resolvePlans({ free: { maxTargets: "5", dailyDigest: "true" } });

    expect(plans.free).toMatchObject({ maxTargets: 5, dailyDigest: true });
  });

  it("leaves other plans untouched by an override", () => {
    const plans = resolvePlans({ free: { maxTargets: "5" } });

    expect(plans.pro.maxTargets).toBe(15);
  });

  it("refuses an override for a field that does not exist", () => {
    const resolve = (): unknown => resolvePlans({ free: { maxTarget: "10" } });

    expect(resolve).toThrow(/PLAN_FREE_/);
  });

  it("refuses an override for a plan that does not exist", () => {
    const resolve = (): unknown => resolvePlans({ gold: { maxTargets: "10" } });

    expect(resolve).toThrow(/no plan called "gold"/);
  });
});
