/**
 * Validation for tenant settings.
 *
 * Split out from `tenant.ts` because that file talks to the database, and a
 * browser form needs these rules too. Importing the queries alongside them
 * would drag the PostgreSQL driver into the page bundle — see `schemas.ts` for
 * the boundary this is on the safe side of.
 */

import { z } from "zod";

export const tenantNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(120, "That name is too long.");

/**
 * IANA zone names are not worth a hand-written regular expression, and a fixed
 * list goes stale every time a country changes its mind. The runtime already
 * ships the database, so ask it.
 */
export function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().refine(isKnownTimezone, {
  message: "Use a zone name like Europe/Berlin.",
});

export const tenantSettingsSchema = z.object({
  name: tenantNameSchema,
  timezone: timezoneSchema,
});

export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;
