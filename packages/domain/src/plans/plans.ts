/**
 * What each plan allows.
 *
 * The unit of pricing is the watched target — see the pricing notes in the
 * wiki. Everything else here exists to keep one account from spending the
 * instance's budget, not to upsell.
 *
 * Pure: no database, no environment. The overrides arrive as an argument (from
 * `PLAN_<NAME>_<FIELD>` variables, read by core's config), so this module can be
 * imported by a browser component that shows the limits.
 */

import { z } from "zod";

export const PLAN_NAMES = ["free", "pro", "team"] as const;

export type PlanName = (typeof PLAN_NAMES)[number];

export interface PlanLimits {
  /** Watched targets across all of a tenant's profiles. */
  readonly maxTargets: number;
  readonly maxProfiles: number;
  /** Onboarding runs that read a site with the model, per calendar month (UTC). */
  readonly discoveryPerMonth: number;
  /** Floor on how often a page diff is fetched. Pages rarely change hourly. */
  readonly diffIntervalMin: number;
  /** How long fetched material is kept before being deleted. */
  readonly retentionDays: number;
  /** Whether the daily cadence may be chosen. Weekly is always allowed. */
  readonly dailyDigest: boolean;
}

/**
 * Starting values. `free` and `pro` are from the pricing sketch; `team` is a
 * guess sized for a small agency watching a handful of clients, and is the
 * first number to revisit when somebody actually buys it.
 */
const DEFAULT_PLANS: Readonly<Record<PlanName, PlanLimits>> = {
  free: {
    maxTargets: 3,
    maxProfiles: 1,
    discoveryPerMonth: 1,
    diffIntervalMin: 1440,
    retentionDays: 30,
    dailyDigest: false,
  },
  pro: {
    maxTargets: 15,
    maxProfiles: 1,
    discoveryPerMonth: 5,
    diffIntervalMin: 360,
    retentionDays: 365,
    dailyDigest: true,
  },
  team: {
    maxTargets: 50,
    maxProfiles: 5,
    discoveryPerMonth: 20,
    diffIntervalMin: 60,
    retentionDays: 365,
    dailyDigest: true,
  },
};

const booleanish = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
  .transform((value) => value === "true" || value === "1" || value === "yes");

const count = z.coerce.number().int().min(0);

const overrideSchema = z
  .object({
    maxTargets: count,
    maxProfiles: count,
    discoveryPerMonth: count,
    diffIntervalMin: z.coerce.number().int().min(10),
    retentionDays: z.coerce.number().int().min(1),
    dailyDigest: booleanish,
  })
  .partial()
  .strict();

export type PlanOverrides = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * The plan table with overrides applied.
 *
 * An override naming a field that does not exist is an error, not something to
 * ignore: `PLAN_FREE_MAX_TARGET=10` (missing S) silently doing nothing is the
 * kind of typo that is found by a customer.
 */
export function resolvePlans(overrides: PlanOverrides = {}): Record<PlanName, PlanLimits> {
  const resolved = { ...DEFAULT_PLANS };

  for (const [name, fields] of Object.entries(overrides)) {
    if (!isPlanName(name)) {
      throw new Error(`PLAN_${name.toUpperCase()}_*: there is no plan called "${name}".`);
    }

    const parsed = overrideSchema.safeParse(fields);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`PLAN_${name.toUpperCase()}_*: ${issue?.message ?? "invalid override"}.`);
    }

    const base = resolved[name];
    const override = parsed.data;
    resolved[name] = {
      maxTargets: override.maxTargets ?? base.maxTargets,
      maxProfiles: override.maxProfiles ?? base.maxProfiles,
      discoveryPerMonth: override.discoveryPerMonth ?? base.discoveryPerMonth,
      diffIntervalMin: override.diffIntervalMin ?? base.diffIntervalMin,
      retentionDays: override.retentionDays ?? base.retentionDays,
      dailyDigest: override.dailyDigest ?? base.dailyDigest,
    };
  }

  return resolved;
}

export function isPlanName(value: string): value is PlanName {
  return (PLAN_NAMES as readonly string[]).includes(value);
}
