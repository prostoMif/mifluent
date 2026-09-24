/**
 * When a profile's digest is due, in the reader's own time.
 *
 * Storage and arithmetic are UTC; the only place a timezone matters is the
 * question "is it Monday 08:00 where this person lives", and that is answered
 * here with `Intl`, which ships with Node and knows every IANA zone.
 */

import type { ProfileDelivery } from "@mifluent/db/schema";

export interface ResolvedDelivery {
  readonly cadence: "weekly" | "daily";
  /** ISO weekday, Monday = 1. */
  readonly weekday: number;
  readonly hour: number;
  readonly timezone: string;
  readonly telegramChatId: string | null;
}

export interface DeliveryDefaults {
  readonly timezone: string;
  readonly hour: number;
  /** Whether the tenant's plan allows a daily digest. */
  readonly isDailyAllowed: boolean;
}

const MONDAY = 1;
const WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function resolveDelivery(
  stored: ProfileDelivery,
  defaults: DeliveryDefaults,
): ResolvedDelivery {
  const cadence = stored.cadence === "daily" && defaults.isDailyAllowed ? "daily" : "weekly";
  const timezone = isKnownZone(stored.timezone) ? stored.timezone : defaults.timezone;

  return {
    cadence,
    weekday: inRange(stored.weekday, 1, 7) ? stored.weekday : MONDAY,
    hour: inRange(stored.hour, 0, 23) ? stored.hour : defaults.hour,
    timezone,
    telegramChatId: stored.telegramChatId ?? null,
  };
}

/** The weekday and hour at `now` in `timezone`. */
export function localTime(now: Date, timezone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekday = WEEKDAYS[parts.find((part) => part.type === "weekday")?.value ?? ""] ?? MONDAY;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  return { weekday, hour };
}

/** True during the hour the digest should go out. The hourly tick calls this. */
export function isDigestDue(delivery: ResolvedDelivery, now: Date): boolean {
  const local = localTime(now, delivery.timezone);
  if (local.hour !== delivery.hour) return false;
  return delivery.cadence === "daily" || local.weekday === delivery.weekday;
}

/**
 * The end of the window a digest built now covers: the top of the current
 * hour. Deterministic within the hour, so two ticks in the same hour produce
 * the same window and the unique index turns the second into a no-op.
 */
export function windowEndFor(now: Date): Date {
  const end = new Date(now);
  end.setUTCMinutes(0, 0, 0);
  return end;
}

export function cadenceDays(cadence: ResolvedDelivery["cadence"]): number {
  return cadence === "daily" ? 1 : 7;
}

export function isKnownZone(zone: string | undefined): zone is string {
  if (zone === undefined || zone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    // An unknown zone is an ordinary "no", not an error: the caller falls
    // back to the instance default.
    return false;
  }
}

function inRange(value: number | undefined, low: number, high: number): value is number {
  return value !== undefined && Number.isInteger(value) && value >= low && value <= high;
}
