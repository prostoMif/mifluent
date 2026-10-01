import { resetConfigCache, uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { completePendingOnboarding, findPendingForEmail } from "./complete.js";
import { hashEmail } from "./pending.js";

const DATABASE_TIMEOUT = 30_000;

const DISCOVERED = {
  business: {
    name: "Bloom Tea",
    description: "Loose-leaf tea shop selling on Ozon and its own site.",
    niche: "tea",
    monetization: "one_time",
    platforms: ["Ozon"],
    countries: ["RU"],
    country: "RU",
    extraCountries: [],
    homeCountry: "RU",
    region: undefined,
    customerType: "consumers",
    language: "ru",
  },
  targets: [
    {
      kind: "competitor",
      name: "Tea Rival",
      websiteUrl: "https://tearival.example",
      reason: "Same niche",
      surfaces: [
        {
          type: "diff",
          url: "https://tearival.example/prices",
          label: "Prices",
          pollIntervalMinutes: 720,
          verified: true,
        },
      ],
      newsQuery: undefined,
    },
  ],
  conditions: [],
  needsDescription: false,
};

async function createPending(db: Database, email: string, reviewed?: unknown): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.pendingOnboardings).values({
    id,
    input: "https://bloomtea.example",
    language: "ru",
    channel: "email",
    emailHash: hashEmail(email),
    ipHash: "ip",
    result: DISCOVERED,
    reviewed: reviewed ?? null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return id;
}

async function createUser(db: Database, email: string): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.user).values({ id, name: "", email });
  return id;
}

describe("completing a visitor's onboarding against a real database", () => {
  let database: TestDatabase;

  // Plan limits read the configuration; these are the variables it requires.
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

  it(
    "creates the tenant and the discovered profile once, named after the business",
    async () => {
      const { db } = database;
      const pendingId = await createPending(db, "owner@bloomtea.example");
      const userId = await createUser(db, "owner@bloomtea.example");

      const found = await findPendingForEmail(db, "Owner@BloomTea.example");
      const first = await completePendingOnboarding(db, {
        pendingId,
        userId,
        defaultTimezone: "UTC",
      });
      const second = await completePendingOnboarding(db, {
        pendingId,
        userId,
        defaultTimezone: "UTC",
      });

      expect(found?.id).toBe(pendingId);
      expect(first).toBeDefined();
      expect(second).toBeUndefined();
      const [tenant] = await db
        .select({ name: schema.tenants.name })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, first?.tenantId ?? ""));
      const targets = await db.select({ name: schema.watchTargets.name }).from(schema.watchTargets);
      const sources = await db.select({ locator: schema.sources.locator }).from(schema.sources);
      expect(tenant?.name).toBe("Bloom Tea");
      expect(targets.map((target) => target.name)).toContain("Tea Rival");
      expect(sources.map((source) => source.locator)).toContain("https://tearival.example/prices");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "creates what the person confirmed, not what discovery first proposed",
    async () => {
      const { db } = database;
      const reviewed = {
        name: "Bloom Tea Shop",
        businessDescription: "Edited description",
        websiteUrl: "https://bloomtea.example",
        facts: {
          monetization: "one_time",
          platforms: ["Ozon"],
          countries: ["RU"],
          country: "RU",
          language: "ru",
        },
        targets: [
          {
            kind: "competitor",
            name: "Added By Hand",
            websiteUrl: null,
            reason: null,
            surfaces: [],
          },
        ],
      };
      const pendingId = await createPending(db, "edit@bloomtea.example", reviewed);
      const userId = await createUser(db, "edit@bloomtea.example");

      await completePendingOnboarding(db, { pendingId, userId, defaultTimezone: "UTC" });

      const [profile] = await db
        .select({ name: schema.watchProfiles.name })
        .from(schema.watchProfiles);
      const targets = await db.select({ name: schema.watchTargets.name }).from(schema.watchTargets);
      expect(profile?.name).toBe("Bloom Tea Shop");
      expect(targets.map((target) => target.name)).toEqual(["Added By Hand"]);
    },
    DATABASE_TIMEOUT,
  );
});
