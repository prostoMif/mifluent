/**
 * Tests for the returner rule.
 *
 * A user is a "returner" if, within the first 14 days after onboarding:
 * - They had actions on 3 different days, AND at least one of those days is on day 7 or later, OR
 * - They have at least one "influenced" action within the first 14 days.
 */

import { describe, expect, it } from "vitest";
import { isReturner } from "./returner-rule.js";

function action(
  occurredAt: Date,
  kind: string,
): { readonly occurredAt: Date; readonly kind: string } {
  return { occurredAt, kind };
}

function daysAfterOnboarding(onboardedAt: Date, days: number[]): Date[] {
  return days.map((d) => new Date(onboardedAt.getTime() + d * 24 * 60 * 60 * 1000));
}

describe("isReturner", () => {
  const onboardedAt = new Date("2026-09-01T10:00:00Z");

  it("returns false for no actions", () => {
    expect(isReturner(onboardedAt, [])).toBe(false);
  });

  it("returns false for actions on fewer than 3 distinct days within 14 days", () => {
    const actions = daysAfterOnboarding(onboardedAt, [1, 2]).map((d) => action(d, "saved"));
    expect(isReturner(onboardedAt, actions)).toBe(false);
  });

  it("returns false for 3 days but none on day 7 or later (days 1, 2, 6)", () => {
    const actions = daysAfterOnboarding(onboardedAt, [1, 2, 6]).map((d) => action(d, "saved"));
    expect(isReturner(onboardedAt, actions)).toBe(false);
  });

  it("returns true for 3 days with one on day 7 (days 1, 2, 7)", () => {
    const actions = daysAfterOnboarding(onboardedAt, [1, 2, 7]).map((d) => action(d, "saved"));
    expect(isReturner(onboardedAt, actions)).toBe(true);
  });

  it("returns true for 3 days with one on day 8 (days 1, 2, 8)", () => {
    const actions = daysAfterOnboarding(onboardedAt, [1, 2, 8]).map((d) => action(d, "saved"));
    expect(isReturner(onboardedAt, actions)).toBe(true);
  });

  it("returns true for 3 days with one on day 13 (days 1, 2, 13)", () => {
    const actions = daysAfterOnboarding(onboardedAt, [1, 2, 13]).map((d) => action(d, "saved"));
    expect(isReturner(onboardedAt, actions)).toBe(true);
  });

  it("returns false for 3 days all before day 7 (days 0, 1, 2)", () => {
    const actions = daysAfterOnboarding(onboardedAt, [0, 1, 2]).map((d) => action(d, "saved"));
    expect(isReturner(onboardedAt, actions)).toBe(false);
  });

  it("returns true if any action is 'influenced' within first 14 days", () => {
    const actions = [
      action(new Date(onboardedAt.getTime() + 1 * 24 * 60 * 60 * 1000), "influenced"),
    ];
    expect(isReturner(onboardedAt, actions)).toBe(true);
  });

  it("returns true if 'influenced' on day 0", () => {
    const actions = [action(onboardedAt, "influenced")];
    expect(isReturner(onboardedAt, actions)).toBe(true);
  });

  it("returns false if 'influenced' is on day 15 (outside window)", () => {
    const actions = [
      action(new Date(onboardedAt.getTime() + 15 * 24 * 60 * 60 * 1000), "influenced"),
    ];
    expect(isReturner(onboardedAt, actions)).toBe(false);
  });

  it("ignores actions after 14-day window for day count", () => {
    const actions = [
      ...daysAfterOnboarding(onboardedAt, [1, 2]).map((d) => action(d, "saved")),
      action(new Date(onboardedAt.getTime() + 15 * 24 * 60 * 60 * 1000), "saved"),
      action(new Date(onboardedAt.getTime() + 20 * 24 * 60 * 60 * 1000), "saved"),
    ];
    // Only 2 days within window (1, 2) - day 15 and 20 are outside
    expect(isReturner(onboardedAt, actions)).toBe(false);
  });

  it("returns true for mixed action kinds on 3 days with one >= day 7", () => {
    const actions = [
      action(new Date(onboardedAt.getTime() + 1 * 24 * 60 * 60 * 1000), "saved"),
      action(new Date(onboardedAt.getTime() + 2 * 24 * 60 * 60 * 1000), "not_important"),
      action(new Date(onboardedAt.getTime() + 7 * 24 * 60 * 60 * 1000), "opened_source"),
    ];
    expect(isReturner(onboardedAt, actions)).toBe(true);
  });

  it("handles actions on same day counting as one day", () => {
    const day1 = new Date(onboardedAt.getTime() + 1 * 24 * 60 * 60 * 1000);
    const day7 = new Date(onboardedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const actions = [
      action(day1, "saved"),
      action(day1, "not_important"),
      action(day7, "opened_source"),
    ];
    // Only 2 distinct days (day 1 and day 7)
    expect(isReturner(onboardedAt, actions)).toBe(false);
  });

  it("returns true for exactly 3 distinct days with last on day 14 (last day of window)", () => {
    const actions = daysAfterOnboarding(onboardedAt, [1, 2, 14]).map((d) => action(d, "saved"));
    expect(isReturner(onboardedAt, actions)).toBe(true);
  });

  it("returns false for 3 days but last is day 15 (outside window)", () => {
    const actions = daysAfterOnboarding(onboardedAt, [1, 2, 15]).map((d) => action(d, "saved"));
    expect(isReturner(onboardedAt, actions)).toBe(false);
  });

  it("actions are assumed sorted by occurredAt (early break)", () => {
    const actions = [
      action(new Date(onboardedAt.getTime() + 1 * 24 * 60 * 60 * 1000), "saved"),
      action(new Date(onboardedAt.getTime() + 15 * 24 * 60 * 60 * 1000), "saved"),
      action(new Date(onboardedAt.getTime() + 2 * 24 * 60 * 60 * 1000), "saved"),
    ];
    // Only first action is within window (day 1) because loop breaks on day 15
    expect(isReturner(onboardedAt, actions)).toBe(false);
  });
});
