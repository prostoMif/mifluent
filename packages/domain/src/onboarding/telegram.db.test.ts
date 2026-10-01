import { resetConfigCache, uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimPendingForTelegram,
  completeTelegramSignup,
  hasTelegramAccount,
  pendingIdToStartParam,
  startParamToPendingId,
} from "./telegram.js";

const DATABASE_TIMEOUT = 30_000;

async function createPending(db: Database): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.pendingOnboardings).values({
    id,
    input: "A tea shop selling on Ozon",
    language: "ru",
    channel: "telegram",
    ipHash: "ip",
    result: {
      business: {
        name: "Bloom Tea",
        description: "Tea shop.",
        niche: "tea",
        monetization: "one_time",
        platforms: [],
        countries: ["RU"],
        country: "RU",
        extraCountries: [],
        customerType: "consumers",
        language: "ru",
      },
      targets: [],
      conditions: [],
    },
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return id;
}

describe("signing up in Telegram against a real database", () => {
  let database: TestDatabase;

  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://unused");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(40));
    vi.stubEnv("BETTER_AUTH_URL", "https://test.example");
    vi.stubEnv("ENCRYPTION_KEY", "e".repeat(40));
    vi.stubEnv("APP_URL", "https://test.example");
    resetConfigCache();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it("carries a pending id through a Telegram start parameter", () => {
    const id = uuidv7();
    expect(pendingIdToStartParam(id)).toMatch(/^w_[0-9a-f]{32}$/);
    expect(startParamToPendingId(pendingIdToStartParam(id))).toBe(id);
    expect(startParamToPendingId("w_nothex")).toBeUndefined();
  });

  it(
    "makes the account, the tenant and a profile delivered to this chat, once",
    async () => {
      const { db } = database;
      const pendingId = await createPending(db);
      const input = {
        pendingId,
        chatId: "555",
        telegramUserId: "555",
        name: "Ann",
        defaultTimezone: "UTC",
      };

      expect(await claimPendingForTelegram(db, input)).toBe(true);
      const first = await completeTelegramSignup(db, input);
      const again = await completeTelegramSignup(db, input);

      expect(first).toBeDefined();
      expect(again).toBeUndefined();
      expect(await hasTelegramAccount(db, "555")).toBe(true);
      const [profile] = await db
        .select({ delivery: schema.watchProfiles.delivery })
        .from(schema.watchProfiles)
        .where(eq(schema.watchProfiles.id, first?.profileId ?? ""));
      expect(profile?.delivery).toMatchObject({ telegramChatId: "555", channel: "telegram" });
    },
    DATABASE_TIMEOUT,
  );

  it(
    "does not let a second Telegram user take over someone's sign-up",
    async () => {
      const { db } = database;
      const pendingId = await createPending(db);
      await claimPendingForTelegram(db, { pendingId, chatId: "1", telegramUserId: "1" });

      const stolenClaim = await claimPendingForTelegram(db, {
        pendingId,
        chatId: "2",
        telegramUserId: "2",
      });
      const stolenConfirm = await completeTelegramSignup(db, {
        pendingId,
        chatId: "2",
        telegramUserId: "2",
        name: "Mallory",
        defaultTimezone: "UTC",
      });

      expect(stolenClaim).toBe(false);
      expect(stolenConfirm).toBeUndefined();
      expect(await hasTelegramAccount(db, "2")).toBe(false);
    },
    DATABASE_TIMEOUT,
  );
});
