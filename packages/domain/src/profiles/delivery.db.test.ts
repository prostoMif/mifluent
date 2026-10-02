import { uuidv7 } from "@mifluent/core";
import { schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deliverySettingsSchema, updateDeliverySettings } from "./delivery.js";

const DATABASE_TIMEOUT = 30_000;
const SETTINGS = {
  cadence: "daily",
  weekday: 1,
  hour: 8,
  timezone: "Europe/Moscow",
  channel: "telegram",
  language: "ru",
} as const;

describe("delivery settings against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "changes when, where and in which language, and keeps the bound chat",
    async () => {
      const { db } = database;
      const tenantId = uuidv7();
      const profileId = uuidv7();
      await db.insert(schema.tenants).values({ id: tenantId, name: "Shop" });
      await db.insert(schema.watchProfiles).values({
        id: profileId,
        tenantId,
        name: "Shop",
        delivery: { telegramChatId: "42" },
        facts: { language: "en", country: "RU" },
      });

      await updateDeliverySettings(db, tenantId, profileId, SETTINGS);

      const [row] = await db
        .select({ delivery: schema.watchProfiles.delivery, facts: schema.watchProfiles.facts })
        .from(schema.watchProfiles)
        .where(eq(schema.watchProfiles.id, profileId));
      expect(row?.delivery).toMatchObject({ telegramChatId: "42", cadence: "daily", hour: 8 });
      expect(row?.facts).toMatchObject({ language: "ru", country: "RU" });
      await expect(updateDeliverySettings(db, uuidv7(), profileId, SETTINGS)).rejects.toMatchObject(
        { code: "not_found" },
      );
    },
    DATABASE_TIMEOUT,
  );

  it("refuses a time zone that does not exist", () => {
    expect(
      deliverySettingsSchema.safeParse({ ...SETTINGS, timezone: "Mars/Olympus" }).success,
    ).toBe(false);
  });
});
