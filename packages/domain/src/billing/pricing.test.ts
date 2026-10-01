import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  EARLY_PRO_TABLE,
  MAX_TOTAL_DISCOUNT,
  PRICE_TABLE,
  quote,
  TERMS,
} from "./pricing.js";

describe("quote", () => {
  it("charges the table price for a plan and term", () => {
    const price = quote({ plan: "pro", months: 3, currency: "RUB", isEarlyEligible: false });

    expect(price.amountMinor).toBe(2_090_00);
    expect(price.isEarly).toBe(false);
  });

  it("gives an eligible Pro buyer the early price", () => {
    const price = quote({ plan: "pro", months: 1, currency: "RUB", isEarlyEligible: true });

    expect(price.amountMinor).toBe(390_00);
    expect(price.isEarly).toBe(true);
  });

  it("never gives the early price on Starter or Team", () => {
    const starter = quote({ plan: "starter", months: 1, currency: "RUB", isEarlyEligible: true });
    const team = quote({ plan: "team", months: 12, currency: "USD", isEarlyEligible: true });

    expect(starter.isEarly).toBe(false);
    expect(team.isEarly).toBe(false);
    expect(team.amountMinor).toBe(379_00);
  });

  it("prices an early Pro year exactly at the 60% cap: 3 790 ₽ and $67", () => {
    expect(
      quote({ plan: "pro", months: 12, currency: "RUB", isEarlyEligible: true }).amountMinor,
    ).toBe(3_790_00);
    expect(
      quote({ plan: "pro", months: 12, currency: "USD", isEarlyEligible: true }).amountMinor,
    ).toBe(67_00);
  });
});

describe("the price tables", () => {
  it("never let the early price fall below the cap for any term", () => {
    for (const currency of CURRENCIES) {
      for (const months of TERMS) {
        const full = PRICE_TABLE[currency].pro[months];
        const floor = Math.floor(full * (1 - MAX_TOTAL_DISCOUNT));

        expect(EARLY_PRO_TABLE[currency][months]).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it("make every longer term cheaper per month than a shorter one", () => {
    for (const currency of CURRENCIES) {
      for (const plan of ["starter", "pro", "team"] as const) {
        const perMonth = TERMS.map((months) => PRICE_TABLE[currency][plan][months] / months);

        expect([...perMonth].sort((left, right) => right - left)).toEqual(perMonth);
      }
    }
  });

  it("match the launch plan's monthly prices", () => {
    expect(PRICE_TABLE.RUB.starter[1]).toBe(290);
    expect(PRICE_TABLE.RUB.pro[1]).toBe(790);
    expect(PRICE_TABLE.RUB.team[1]).toBe(1_990);
    expect(PRICE_TABLE.USD.starter[1]).toBe(6);
    expect(PRICE_TABLE.USD.pro[1]).toBe(14);
    expect(PRICE_TABLE.USD.team[1]).toBe(45);
  });
});

describe("quote with discounts", () => {
  const campaign = { code: "LAUNCH_RU", kind: "campaign", percentOff: 40, months: null } as const;
  const partner = { code: "BLOGGER", kind: "code", percentOff: 20, months: 3 } as const;
  const edu = { code: "EDU", kind: "code", percentOff: 50, months: null } as const;

  it("lets a campaign replace the year's discount instead of adding to it", () => {
    // Full year 790 × 12 = 9 480; −40% = 5 688, below the table's 6 590 (−30%).
    const price = quote({
      plan: "pro",
      months: 12,
      currency: "RUB",
      isEarlyEligible: false,
      discounts: [campaign],
    });
    expect(price.amountMinor).toBe(5_688_00);
    expect(price.appliedCode).toBe("LAUNCH_RU");
  });

  it("takes a percentage off the term price only for the months the code covers", () => {
    // 20% on 3 of 12 months: 6 590 × (1 − 0.2 × 3/12) = 6 260.5 → 6 261.
    const year = quote({
      plan: "pro",
      months: 12,
      currency: "RUB",
      isEarlyEligible: false,
      discounts: [partner],
    });
    const month = quote({
      plan: "pro",
      months: 1,
      currency: "RUB",
      isEarlyEligible: false,
      discounts: [partner],
    });
    expect(year.amountMinor).toBe(6_261_00);
    expect(month.amountMinor).toBe(632_00);
  });

  it("does not stack promo discounts: the cheapest one wins", () => {
    const price = quote({
      plan: "starter",
      months: 1,
      currency: "USD",
      isEarlyEligible: false,
      discounts: [partner, edu, campaign],
    });
    expect(price.amountMinor).toBe(3_00);
    expect(price.appliedCode).toBe("EDU");
  });

  it("never goes past 60% off the full price, even on the early price", () => {
    const price = quote({
      plan: "pro",
      months: 12,
      currency: "RUB",
      isEarlyEligible: true,
      discounts: [edu],
    });
    expect(price.amountMinor).toBe(3_790_00);
    expect(price.appliedCode).toBeNull();

    const capped = quote({
      plan: "team",
      months: 1,
      currency: "RUB",
      isEarlyEligible: false,
      discounts: [{ code: "ALL", kind: "code", percentOff: 90, months: null }],
    });
    expect(capped.amountMinor).toBe(796_00);
  });

  it("rounds to whole roubles and whole dollars", () => {
    for (const currency of CURRENCIES) {
      for (const months of TERMS) {
        const price = quote({
          plan: "starter",
          months,
          currency,
          isEarlyEligible: false,
          discounts: [partner],
        });
        expect(price.amountMinor % 100).toBe(0);
      }
    }
  });

  it("leaves the price alone when a discount would make it dearer", () => {
    // −10% off the full year is 3 132, dearer than the table's 2 390.
    const price = quote({
      plan: "starter",
      months: 12,
      currency: "RUB",
      isEarlyEligible: false,
      discounts: [{ code: "SMALL", kind: "campaign", percentOff: 10, months: null }],
    });
    expect(price.amountMinor).toBe(2_390_00);
    expect(price.appliedCode).toBeNull();
  });
});
