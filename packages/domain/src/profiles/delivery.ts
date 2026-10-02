/**
 * When and where a profile's brief is sent, and in which language — the
 * settings a reader changes most, kept apart from what is watched so that
 * changing them never creates a profile version.
 *
 * The plan still decides: a daily cadence on a plan without it is stored as
 * asked, and the scheduler sends weekly until the plan allows daily.
 */

import { AppError } from "@mifluent/core";
import { type Queryable, schema, scopedAlive } from "@mifluent/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DeliverySettings } from "./delivery-types.js";

/** Typed against the browser-safe shape, so the two cannot drift apart. */
export const deliverySettingsSchema: z.ZodType<DeliverySettings> = z.object({
  cadence: z.enum(["daily", "weekly"]),
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone."),
  channel: z.enum(["telegram", "email"]),
  language: z.enum(["en", "ru"]),
});

export type { DeliverySettings } from "./delivery-types.js";

export async function updateDeliverySettings(
  db: Queryable,
  tenantId: string,
  profileId: string,
  settings: DeliverySettings,
): Promise<void> {
  const { language, ...delivery } = settings;
  const updated = await db
    .update(schema.watchProfiles)
    .set({
      delivery: sql`${schema.watchProfiles.delivery} || ${JSON.stringify(delivery)}::jsonb`,
      facts: sql`${schema.watchProfiles.facts} || ${JSON.stringify({ language })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .returning({ id: schema.watchProfiles.id });
  if (updated.length === 0) throw new AppError("not_found", "Not found.");
}

/** The settings as the form should show them: stored values, or the defaults the scheduler uses. */
export async function readDeliverySettings(
  db: Queryable,
  tenantId: string,
  profileId: string,
  defaultTimezone: string,
): Promise<DeliverySettings | undefined> {
  const [row] = await db
    .select({ delivery: schema.watchProfiles.delivery, facts: schema.watchProfiles.facts })
    .from(schema.watchProfiles)
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .limit(1);
  if (row === undefined) return undefined;
  const language = row.facts.language === "ru" ? "ru" : "en";
  return {
    cadence: row.delivery.cadence ?? "weekly",
    weekday: row.delivery.weekday ?? 1,
    hour: row.delivery.hour ?? 8,
    timezone: row.delivery.timezone ?? defaultTimezone,
    channel:
      row.delivery.channel ??
      (row.delivery.telegramChatId !== undefined || language === "ru" ? "telegram" : "email"),
    language,
  };
}
