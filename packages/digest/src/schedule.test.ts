import { describe, expect, it } from "vitest";
import { planWindow } from "./build.js";
import { isDigestDue, resolveDelivery, windowEndFor } from "./schedule.js";

const defaults = { timezone: "UTC", hour: 8, isDailyAllowed: false };

describe("resolveDelivery", () => {
  it("defaults to Monday at the instance hour, weekly", () => {
    const delivery = resolveDelivery({}, defaults);

    expect(delivery).toMatchObject({ cadence: "weekly", weekday: 1, hour: 8, timezone: "UTC" });
  });

  it("falls back to weekly when the plan does not allow daily", () => {
    const delivery = resolveDelivery({ cadence: "daily" }, defaults);

    expect(delivery.cadence).toBe("weekly");
  });

  it("ignores a timezone that does not exist", () => {
    const delivery = resolveDelivery({ timezone: "Mars/Olympus" }, defaults);

    expect(delivery.timezone).toBe("UTC");
  });
});

describe("isDigestDue", () => {
  it("is due at 08:00 on Monday in the reader's zone, not in UTC", () => {
    const delivery = resolveDelivery({ timezone: "Asia/Vladivostok" }, defaults);
    // Monday 08:30 in Vladivostok (UTC+10) is Sunday 22:30 UTC.
    const now = new Date("2026-09-27T22:30:00Z");

    const isDue = isDigestDue(delivery, now);

    expect(isDue).toBe(true);
  });

  it("is not due at the right hour on the wrong day", () => {
    const delivery = resolveDelivery({}, defaults);
    const tuesday = new Date("2026-09-29T08:10:00Z");

    const isDue = isDigestDue(delivery, tuesday);

    expect(isDue).toBe(false);
  });

  it("is due every day for a daily cadence", () => {
    const delivery = resolveDelivery({ cadence: "daily" }, { ...defaults, isDailyAllowed: true });
    const tuesday = new Date("2026-09-29T08:10:00Z");

    const isDue = isDigestDue(delivery, tuesday);

    expect(isDue).toBe(true);
  });
});

describe("planWindow", () => {
  const end = windowEndFor(new Date("2026-09-28T08:42:00Z"));

  it("ends at the top of the hour", () => {
    expect(end.toISOString()).toBe("2026-09-28T08:00:00.000Z");
  });

  it("looks a week back on the first run", () => {
    const window = planWindow({ previousEnd: null, end, cadence: "weekly", isWidened: false });

    expect(window.start.toISOString()).toBe("2026-09-21T08:00:00.000Z");
  });

  it("looks a month back when the first week was empty", () => {
    const window = planWindow({ previousEnd: null, end, cadence: "weekly", isWidened: true });

    expect(window.start.toISOString()).toBe("2026-08-29T08:00:00.000Z");
  });

  it("starts where the previous digest ended", () => {
    const previousEnd = new Date("2026-09-24T08:00:00Z");

    const window = planWindow({ previousEnd, end, cadence: "weekly", isWidened: false });

    expect(window.start).toEqual(previousEnd);
  });

  it("never reaches further back than a month", () => {
    const previousEnd = new Date("2026-01-01T00:00:00Z");

    const window = planWindow({ previousEnd, end, cadence: "weekly", isWidened: false });

    expect(window.start.toISOString()).toBe("2026-08-29T08:00:00.000Z");
  });
});
