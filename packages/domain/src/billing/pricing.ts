/**
 * What a plan costs for a given number of months, in either currency.
 *
 * Prices are a table, not a formula. The term discounts (−10% for three
 * months, −20% for six, −30% for a year) are applied once, by hand, and the
 * results rounded to prices a person would write on a page: 2 090 ₽, not
 * 2 133 ₽. Computing them on the fly would print the ugly numbers, and a
 * rounding rule nobody wrote down would decide what customers pay.
 *
 * Pure: shared by the pricing page in the browser and the checkout on the
 * server, so both always show and charge the same figure.
 */

export const PAID_PLANS = ["starter", "pro", "team"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export const TERMS = [1, 3, 6, 12] as const;
export type TermMonths = (typeof TERMS)[number];

export const CURRENCIES = ["RUB", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

type PriceTable = Readonly<
  Record<Currency, Readonly<Record<PaidPlan, Readonly<Record<TermMonths, number>>>>>
>;

/** Whole roubles and whole dollars. From the launch plan, §3. */
export const PRICE_TABLE: PriceTable = {
  RUB: {
    starter: { 1: 290, 3: 790, 6: 1_390, 12: 2_390 },
    pro: { 1: 790, 3: 2_090, 6: 3_790, 12: 6_590 },
    team: { 1: 1_990, 3: 5_390, 6: 9_490, 12: 16_690 },
  },
  USD: {
    starter: { 1: 6, 3: 16, 6: 29, 12: 49 },
    pro: { 1: 14, 3: 38, 6: 67, 12: 119 },
    team: { 1: 45, 3: 119, 6: 215, 12: 379 },
  },
};

/**
 * Pro for the first paying accounts: 390 ₽ / $7 a month, with the same term
 * discounts, but never below 40% of the full price for the same term — the
 * early price and the term discount together are capped at 60% off. The year
 * hits that cap exactly: 3 790 ₽ and $67.
 */
export const EARLY_PRO_TABLE: Readonly<Record<Currency, Readonly<Record<TermMonths, number>>>> = {
  RUB: { 1: 390, 3: 1_090, 6: 1_890, 12: 3_790 },
  USD: { 1: 7, 3: 19, 6: 34, 12: 67 },
};

/** The deepest total discount any combination may give. */
export const MAX_TOTAL_DISCOUNT = 0.6;

/** How many Pro accounts get the early price. Shared between the two markets. */
export const DEFAULT_EARLY_SEATS = 100;

export interface PriceQuote {
  readonly plan: PaidPlan;
  readonly months: TermMonths;
  readonly currency: Currency;
  /** Kopecks or cents. */
  readonly amountMinor: number;
  readonly isEarly: boolean;
  /** The undiscounted monthly price times the months, for "you save" lines. */
  readonly fullAmountMinor: number;
}

export interface QuoteInput {
  readonly plan: PaidPlan;
  readonly months: TermMonths;
  readonly currency: Currency;
  /** True when the tenant already holds an early seat, or one is still free. */
  readonly isEarlyEligible: boolean;
}

export function quote(input: QuoteInput): PriceQuote {
  const isEarly = input.plan === "pro" && input.isEarlyEligible;
  const amount = isEarly
    ? EARLY_PRO_TABLE[input.currency][input.months]
    : PRICE_TABLE[input.currency][input.plan][input.months];

  return {
    plan: input.plan,
    months: input.months,
    currency: input.currency,
    amountMinor: amount * 100,
    isEarly,
    fullAmountMinor: PRICE_TABLE[input.currency][input.plan][1] * input.months * 100,
  };
}

export function isPaidPlan(value: string): value is PaidPlan {
  return (PAID_PLANS as readonly string[]).includes(value);
}

export function isTerm(value: number): value is TermMonths {
  return (TERMS as readonly number[]).includes(value);
}
