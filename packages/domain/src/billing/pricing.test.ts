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
