import { describe, expect, it } from "vitest";
import {
  hasFailedTooOften,
  isDueForPoll,
  nextIntervalMinutes,
  nextPollDueAt,
  type PollDecision,
} from "./schedule.js";

const NOW = new Date("2026-08-18T12:00:00Z");

function source(overrides: Partial<PollDecision> = {}): PollDecision {
  return {
    status: "active",
    lastPolledAt: new Date("2026-08-18T11:00:00Z"),
    pollIntervalMinutes: 60,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("nextIntervalMinutes", () => {
  it("uses the source's own interval while it is healthy", () => {
    expect(nextIntervalMinutes(source())).toBe(60);
  });

  it("doubles the wait with each consecutive failure", () => {
    expect(nextIntervalMinutes(source({ consecutiveFailures: 1 }))).toBe(120);
    expect(nextIntervalMinutes(source({ consecutiveFailures: 2 }))).toBe(240);
    expect(nextIntervalMinutes(source({ consecutiveFailures: 3 }))).toBe(480);
  });

  it("stops doubling at a day", () => {
    // Without a ceiling, twenty failures would push the next attempt years out
    // and the source would never be seen to recover.
    expect(nextIntervalMinutes(source({ consecutiveFailures: 20 }))).toBe(1440);
  });

  it("survives an interval of zero", () => {
    // A zero would otherwise mean "poll continuously", which is how an instance
    // gets itself blocked.
    expect(nextIntervalMinutes(source({ pollIntervalMinutes: 0 }))).toBe(1);
  });
});

describe("isDueForPoll", () => {
  it("polls a source that has never been polled", () => {
    // Somebody has just added it and is watching to see whether it works.
    expect(isDueForPoll(source({ lastPolledAt: null }), NOW)).toBe(true);
  });

  it("polls once the interval has passed", () => {
    expect(isDueForPoll(source({ lastPolledAt: new Date("2026-08-18T11:00:00Z") }), NOW)).toBe(
      true,
    );
  });

  it("waits when the interval has not passed", () => {
    expect(isDueForPoll(source({ lastPolledAt: new Date("2026-08-18T11:30:00Z") }), NOW)).toBe(
      false,
    );
  });

  it("never polls a paused source", () => {
    expect(isDueForPoll(source({ status: "paused", lastPolledAt: null }), NOW)).toBe(false);
  });

  it("never polls a source that has been set aside as broken", () => {
    expect(isDueForPoll(source({ status: "broken", lastPolledAt: null }), NOW)).toBe(false);
  });

  it("waits longer after a failure than it would have otherwise", () => {
    const oneHourAgo = new Date("2026-08-18T11:00:00Z");

    expect(isDueForPoll(source({ lastPolledAt: oneHourAgo, consecutiveFailures: 0 }), NOW)).toBe(
      true,
    );
    expect(isDueForPoll(source({ lastPolledAt: oneHourAgo, consecutiveFailures: 1 }), NOW)).toBe(
      false,
    );
  });
});

describe("nextPollDueAt", () => {
  it("gives a time that can be shown to a person", () => {
    expect(nextPollDueAt(source())?.toISOString()).toBe("2026-08-18T12:00:00.000Z");
  });

  it("gives nothing for a source that is not on a schedule", () => {
    expect(nextPollDueAt(source({ status: "paused" }))).toBeNull();
  });
});

describe("hasFailedTooOften", () => {
  it("keeps trying through a short outage", () => {
    expect(hasFailedTooOften(0)).toBe(false);
    expect(hasFailedTooOften(5)).toBe(false);
  });

  it("gives up once failures have gone on for about two days", () => {
    expect(hasFailedTooOften(6)).toBe(true);
  });
});
