/**
 * Deciding when a source should next be polled.
 *
 * Two things are being balanced. Poll too rarely and the product stops being a
 * morning brief. Poll too often and the publisher rate-limits or blocks the
 * instance, which looks to its owner like the product breaking for no reason.
 *
 * The backoff is the part worth explaining, and it is an idea every long-lived
 * feed reader arrives at — Miniflux among them. A source that has failed six
 * times in a row is not going to succeed on the seventh because it was asked
 * sooner. Continuing to ask it every hour costs the publisher bandwidth, costs
 * the instance a worker, and buries the sources that are merely having a bad
 * morning under the ones that have been dead for a week. So the interval
 * doubles with each consecutive failure, and a source that keeps failing is
 * eventually set aside rather than retried forever.
 *
 * Set aside, not deleted. A feed that moved comes back when its owner fixes the
 * address, and the person who added it should be told it is broken rather than
 * find it silently gone.
 */

export type SourceStatus = "active" | "paused" | "broken";

/**
 * A day. Past this the doubling stops: a source checked once a day is checked
 * often enough to notice it came back, and no less politely than one checked
 * once a week.
 */
const MAXIMUM_INTERVAL_MINUTES = 24 * 60;

/**
 * After this many consecutive failures a source stops being polled on schedule.
 *
 * Six, because with doubling that is roughly two days of trying before giving
 * up — long enough to ride out a certificate renewal or a weekend outage, short
 * enough that a genuinely dead feed is not still being asked next month.
 */
const FAILURES_BEFORE_BROKEN = 6;

export interface PollDecision {
  readonly status: SourceStatus;
  readonly lastPolledAt: Date | null;
  /** The source's own setting: a changelog is not a news feed. */
  readonly pollIntervalMinutes: number;
  readonly consecutiveFailures: number;
}

/**
 * How long to wait before the next attempt, given how badly it is going.
 *
 * Exported separately from the decision below so the number can be shown in the
 * interface. "Next check in 4 hours" explains a quiet source; a source that
 * simply says nothing does not.
 */
export function nextIntervalMinutes(decision: PollDecision): number {
  const base = Math.max(1, decision.pollIntervalMinutes);

  if (decision.consecutiveFailures === 0) {
    return base;
  }

  const doubled = base * 2 ** decision.consecutiveFailures;
  return Math.min(doubled, MAXIMUM_INTERVAL_MINUTES);
}

/**
 * When this source is next due, or null if it is not on a schedule at all.
 *
 * A source that has never been polled is due immediately — somebody has just
 * added it and is waiting to see whether it works.
 */
export function nextPollDueAt(decision: PollDecision): Date | null {
  if (decision.status !== "active") {
    return null;
  }

  if (decision.lastPolledAt === null) {
    return new Date(0);
  }

  const waitMs = nextIntervalMinutes(decision) * 60 * 1000;
  return new Date(decision.lastPolledAt.getTime() + waitMs);
}

export function isDueForPoll(decision: PollDecision, now: Date): boolean {
  const dueAt = nextPollDueAt(decision);
  return dueAt !== null && dueAt.getTime() <= now.getTime();
}

/**
 * Whether this source has failed often enough to be set aside.
 *
 * The caller flips the status and tells the person; nothing here writes.
 */
export function hasFailedTooOften(consecutiveFailures: number): boolean {
  return consecutiveFailures >= FAILURES_BEFORE_BROKEN;
}
