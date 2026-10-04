import { uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCachedDiscovery } from "./pending.js";

const DATABASE_TIMEOUT = 30_000;

function resultFor(name: string): Record<string, unknown> {
  return {
    business: { name, description: "", niche: "", platforms: [], countries: [] },
    targets: [],
    conditions: [],
    needsDescription: false,
  };
}

async function addPending(db: Database, input: string, name: string): Promise<void> {
  await db.insert(schema.pendingOnboardings).values({
    id: uuidv7(),
    input,
    language: "ru",
    channel: "email",
    ipHash: "ip",
    result: resultFor(name),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

describe("the discovery cache against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "returns a result only for exactly the same site, never for one whose name contains it",
    async () => {
      const { db } = database;
      await addPending(db, "https://spa.ru", "Spa Salon");

      expect(await findCachedDiscovery(db, "https://a.ru")).toBeUndefined();
      const same = await findCachedDiscovery(db, "https://www.spa.ru/");
      expect((same as { business: { name: string } } | undefined)?.business.name).toBe("Spa Salon");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "treats LIKE wildcards in an address literally",
    async () => {
      const { db } = database;
      await addPending(db, "https://my-shop.ru", "My Shop");

      expect(await findCachedDiscovery(db, "https://my_shop.ru")).toBeUndefined();
    },
    DATABASE_TIMEOUT,
  );
});
