import { uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPackCatalogue, packCandidates } from "./candidates.js";
import type { PackFile } from "./schema.js";
import { syncPacks } from "./sync.js";
import { PACKS_PROFILE_ID, PACKS_TENANT_ID } from "./tenant.js";

// Booting Postgres and applying every migration takes a few seconds.
const DATABASE_TIMEOUT = 30_000;

function packFile(key: string, urls: readonly string[]): PackFile {
  return {
    key,
    title: { ru: key, en: key },
    market: "ru",
    countries: ["RU"],
    regions: [],
    applies_to: "any",
    kind: "platform",
    niches: [],
    applies_when: { platforms_any: [], niches_any: [] },
    sources: urls.map((url) => ({ label: "News", type: "feed", url, interval_minutes: 60 })),
    max_cards_per_digest: 3,
  };
}

async function createCustomer(db: Database): Promise<{ tenantId: string; profileId: string }> {
  const tenantId = uuidv7();
  const profileId = uuidv7();
  await db.insert(schema.tenants).values({ id: tenantId, name: "Customer" });
  await db.insert(schema.watchProfiles).values({ id: profileId, tenantId, name: "Shop" });
  return { tenantId, profileId };
}

/** A fetched, chunked item: the state in which selection may consider it. */
async function insertItem(db: Database, tenantId: string, sourceId: string): Promise<string> {
  const itemId = uuidv7();
  await db.insert(schema.rawItems).values({
    id: itemId,
    tenantId,
    sourceId,
    content: "Commission changes from November",
    contentHash: itemId,
  });
  await db.insert(schema.chunks).values({
    id: uuidv7(),
    tenantId,
    rawItemId: itemId,
    ordinal: 0,
    content: "Commission changes from November",
    startOffset: 0,
    endOffset: 32,
    contentHash: itemId,
  });
  return itemId;
}

async function packSourceId(db: Database, url: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(eq(schema.sources.locator, url));
  if (row === undefined) throw new Error(`no source for ${url}`);
  return row.id;
}

const SINCE = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

describe("source packs against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "creates nothing the second time the same files are synced",
    async () => {
      const packs = [packFile("ru.platforms.wildberries", ["https://example.com/wb.rss"])];

      const first = await syncPacks(database.db, packs);
      const second = await syncPacks(database.db, packs);

      expect(first.sourcesCreated).toBe(1);
      expect(second.sourcesCreated).toBe(0);
      expect(second.sourcesPaused).toBe(0);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "pauses a source whose pack file was removed, and keeps the row",
    async () => {
      await syncPacks(database.db, [
        packFile("ru.platforms.wildberries", ["https://example.com/wb.rss"]),
        packFile("ru.platforms.ozon", ["https://example.com/ozon.rss"]),
      ]);

      const result = await syncPacks(database.db, [
        packFile("ru.platforms.wildberries", ["https://example.com/wb.rss"]),
      ]);

      const [ozon] = await database.db
        .select({ status: schema.sources.status })
        .from(schema.sources)
        .where(eq(schema.sources.locator, "https://example.com/ozon.rss"));
      expect(result.sourcesPaused).toBe(1);
      expect(ozon?.status).toBe("paused");
      expect((await loadPackCatalogue(database.db)).map((pack) => pack.key)).toEqual([
        "ru.platforms.wildberries",
      ]);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "gives a profile the material of a pack it follows",
    async () => {
      const { db } = database;
      await syncPacks(db, [packFile("ru.platforms.wildberries", ["https://example.com/wb.rss"])]);
      const itemId = await insertItem(
        db,
        PACKS_TENANT_ID,
        await packSourceId(db, "https://example.com/wb.rss"),
      );
      const customer = await createCustomer(db);

      const found = await packCandidates(db, {
        ...customer,
        packs: await loadPackCatalogue(db),
        since: SINCE,
        limit: 50,
      });

      expect(found.map((item) => item.id)).toEqual([itemId]);
      expect(found[0]?.packKey).toBe("ru.platforms.wildberries");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "gives a profile nothing from a pack it does not follow",
    async () => {
      const { db } = database;
      await syncPacks(db, [packFile("ru.platforms.wildberries", ["https://example.com/wb.rss"])]);
      await insertItem(db, PACKS_TENANT_ID, await packSourceId(db, "https://example.com/wb.rss"));
      const customer = await createCustomer(db);

      const found = await packCandidates(db, { ...customer, packs: [], since: SINCE, limit: 50 });

      expect(found).toEqual([]);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "never returns another customer's material, even if it were linked to a pack",
    async () => {
      const { db } = database;
      await syncPacks(db, [packFile("ru.platforms.wildberries", ["https://example.com/wb.rss"])]);
      const other = await createCustomer(db);
      const otherSourceId = uuidv7();
      await db.insert(schema.sources).values({
        id: otherSourceId,
        tenantId: other.tenantId,
        profileId: other.profileId,
        kind: "rss",
        label: "Private feed",
        locator: "https://example.com/private.rss",
      });
      await insertItem(db, other.tenantId, otherSourceId);
      // The catalogue never links a customer's source; this simulates a bug
      // that did. The tenant predicate must still keep the row out.
      await db
        .insert(schema.packSources)
        .values({ id: uuidv7(), packKey: "ru.platforms.wildberries", sourceId: otherSourceId });
      const customer = await createCustomer(db);

      const found = await packCandidates(db, {
        ...customer,
        packs: await loadPackCatalogue(db),
        since: SINCE,
        limit: 50,
      });

      expect(found).toEqual([]);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "does not offer again material this profile already rejected",
    async () => {
      const { db } = database;
      await syncPacks(db, [packFile("ru.platforms.wildberries", ["https://example.com/wb.rss"])]);
      const itemId = await insertItem(
        db,
        PACKS_TENANT_ID,
        await packSourceId(db, "https://example.com/wb.rss"),
      );
      const customer = await createCustomer(db);
      await db.insert(schema.rejections).values({
        id: uuidv7(),
        tenantId: customer.tenantId,
        profileId: customer.profileId,
        rawItemId: itemId,
        reason: "below_cosine",
        score: "0.100",
      });

      const found = await packCandidates(db, {
        ...customer,
        packs: await loadPackCatalogue(db),
        since: SINCE,
        limit: 50,
      });

      expect(found).toEqual([]);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "keeps the service profile out of the digest scheduler's reach",
    async () => {
      await syncPacks(database.db, [
        packFile("ru.platforms.wildberries", ["https://example.com/wb.rss"]),
      ]);

      const [profile] = await database.db
        .select({ versionId: schema.watchProfiles.currentVersionId })
        .from(schema.watchProfiles)
        .where(eq(schema.watchProfiles.id, PACKS_PROFILE_ID));

      expect(profile?.versionId).toBeNull();
    },
    DATABASE_TIMEOUT,
  );
});
