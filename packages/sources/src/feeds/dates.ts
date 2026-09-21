/**
 * Reading the date off a feed item.
 *
 * Two formats are specified — RFC 822 for RSS, RFC 3339 for Atom — and neither
 * is what arrives. Dates in real feeds are missing, truncated, two-digit,
 * written in the publisher's own language, or set in the future so the item
 * pins itself to the top of every reader.
 *
 * The decision that matters here, and it is a product decision rather than a
 * parsing one: **an unreadable date becomes null, never "now".**
 *
 * Substituting the current time is the obvious shortcut and it is wrong. It
 * makes a three-year-old article look like it was published this morning, which
 * puts it at the top of somebody's digest — and the digest's entire promise is
 * "here is what changed since yesterday". One wrongly dated item does more
 * damage to that promise than a missing date ever could.
 */

/**
 * Nothing published before this is a change worth waking up to, and a date this
 * old is almost always a parsing accident — an empty string read as the Unix
 * epoch, or a two-digit year understood as 1901.
 */
const EARLIEST_PLAUSIBLE_YEAR = 1990;

/**
 * How far into the future a date may sit before it is treated as deliberate.
 *
 * A little slack is needed for clock skew and for a publisher in a timezone
 * ahead of the server. Beyond that, a future date is a publisher pinning an
 * item to the top of every reader, and it is clamped rather than believed.
 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface ParseDateOptions {
  /** Passed in rather than read from the clock, so the rule can be tested. */
  readonly now?: Date | undefined;
}

export function parseFeedDate(value: unknown, options: ParseDateOptions = {}): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (parsed.getUTCFullYear() < EARLIEST_PLAUSIBLE_YEAR) {
    return null;
  }

  const now = options.now ?? new Date();

  // Clamped rather than dropped: the item is real and recent, only its
  // timestamp is a marketing decision.
  if (parsed.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return now;
  }

  return parsed;
}
