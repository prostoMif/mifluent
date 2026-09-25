/**
 * Horizontal escalation, against a real database: can tenant A reach tenant
 * B's rows?
 *
 * Every case here is a query the unit tests cannot judge. `scoped(...)` and a
 * bare `eq(id, ...)` produce the same TypeScript and different SQL, and only a
 * server can tell them apart — which is why `createSource` could write into
 * another tenant's profile while the suite stayed green.
 *
 * Each test builds two tenants, acts as one against the other's rows, and
 * expects "not found" — never "forbidden", which would confirm the row exists.
 */

import { randomUUID } from "node:crypto";
import { AppError } from "@mifluent/core";
import type { Database } from "@mifluent/db";
import { schema } from "@mifluent/db";
import {
  createSource,
  deleteSource,
  findWatchProfile,
  listDecisions,
  listSources,
  recordDecision,
  saveWatchProfile,
} from "@mifluent/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestTenant,
  deleteTestTenants,
  getTestDatabase,
  hasTestDatabase,
  type TestTenant,
} from "./database.js";

/** Its own address each time: the unique index is on (profile, kind, locator). */
function feed(): { kind: "rss"; label: string; locator: string; pollIntervalMinutes: number } {
  return {
    kind: "rss",
    label: "Their blog",
    locator: `https://example.com/${randomUUID()}/feed`,
    pollIntervalMinutes: 60,
  };
}

describe.skipIf(!hasTestDatabase)("tenant isolation", () => {
  let db: Database;
  let mine: TestTenant;
  let theirs: TestTenant;

  beforeAll(async () => {
    db = await getTestDatabase();
    mine = await createTestTenant(db);
    theirs = await createTestTenant(db);
  }, 60_000);

  afterAll(async () => {
    await deleteTestTenants(db, [mine.tenantId, theirs.tenantId]);
  });

  it("refuses to add a source to another tenant's profile", async () => {
    // The regression for the hole this suite exists because of: the profile
    // came from a request path, the tenant from the session, and nothing
    // checked that the two belonged together.
    const create = createSource({
      db,
      tenantId: mine.tenantId,
      profileId: theirs.profileId,
      input: feed(),
    });

    await expect(create).rejects.toThrow(AppError);
    expect(await listSources(db, theirs.tenantId, theirs.profileId)).toEqual([]);
  }, 10_000);

  it("still adds a source to the caller's own profile", async () => {
    const sourceId = await createSource({
      db,
      tenantId: mine.tenantId,
      profileId: mine.profileId,
      input: feed(),
    });

    const mineNow = await listSources(db, mine.tenantId, mine.profileId);
    expect(mineNow.map((source) => source.id)).toContain(sourceId);

    await deleteSource(db, mine.tenantId, sourceId);
  });

  it("refuses to delete another tenant's source", async () => {
    const sourceId = await createSource({
      db,
      tenantId: theirs.tenantId,
      profileId: theirs.profileId,
      input: feed(),
    });

    await expect(deleteSource(db, mine.tenantId, sourceId)).rejects.toThrow(AppError);

    const theirsNow = await listSources(db, theirs.tenantId, theirs.profileId);
    expect(theirsNow.map((source) => source.id)).toContain(sourceId);
  });

  it("does not return another tenant's profile by id", async () => {
    expect(await findWatchProfile(db, mine.tenantId, theirs.profileId)).toBeUndefined();
  });

  it("refuses to save another tenant's profile", async () => {
    const save = saveWatchProfile({
      db,
      tenantId: mine.tenantId,
      profileId: theirs.profileId,
      input: {
        name: "renamed by someone else",
        businessDescription: null,
        websiteUrl: null,
        relevanceThreshold: 0.5,
        topics: [],
        targets: [],
        stopwords: [],
        changeReason: null,
      },
    });

    await expect(save).rejects.toThrow(AppError);

    const [profile] = await db
      .select({ name: schema.watchProfiles.name })
      .from(schema.watchProfiles)
      .where(eq(schema.watchProfiles.id, theirs.profileId));
    expect(profile?.name).not.toBe("renamed by someone else");
  });

  it("refuses to write a decision against another tenant's card", async () => {
    const cardId = await seedCard(db, theirs);

    const record = recordDecision(db, { tenantId: mine.tenantId, cardId, text: "not mine" });

    await expect(record).rejects.toThrow(AppError);
    expect(await listDecisions(db, theirs.tenantId, theirs.profileId)).toEqual([]);
  });

  it("does not list another tenant's decisions", async () => {
    const cardId = await seedCard(db, theirs);
    await recordDecision(db, { tenantId: theirs.tenantId, cardId, text: "holding our price" });

    expect(await listDecisions(db, mine.tenantId, theirs.profileId)).toEqual([]);
    expect(await listDecisions(db, theirs.tenantId, theirs.profileId)).toHaveLength(1);
  });

  it("answers about a missing row and a foreign row the same way", async () => {
    // "Forbidden" on the second would confirm it exists.
    const foreign = recordDecision(db, {
      tenantId: mine.tenantId,
      cardId: await seedCard(db, theirs),
      text: "a line",
    });
    const missing = recordDecision(db, {
      tenantId: mine.tenantId,
      cardId: randomUUID(),
      text: "a line",
    });

    await expect(foreign).rejects.toMatchObject({ code: "not_found" });
    await expect(missing).rejects.toMatchObject({ code: "not_found" });
  });
});

/**
 * The smallest chain a card needs to exist: an event on a raw item from a
 * source, a digest, and the card itself. `recordDecision` walks all of it.
 */
async function seedCard(db: Database, tenant: TestTenant): Promise<string> {
  const sourceId = randomUUID();
  const rawItemId = randomUUID();
  const eventId = randomUUID();
  const digestId = randomUUID();
  const cardId = randomUUID();
  const now = new Date();

  await db.insert(schema.sources).values({
    id: sourceId,
    tenantId: tenant.tenantId,
    profileId: tenant.profileId,
    kind: "rss",
    label: "seed",
    locator: `https://example.com/${sourceId}`,
  });
  await db.insert(schema.rawItems).values({
    id: rawItemId,
    tenantId: tenant.tenantId,
    sourceId,
    content: "Their Pro plan is now $29 per month.",
    contentHash: rawItemId,
    fetchedAt: now,
  });
  await db.insert(schema.events).values({
    id: eventId,
    tenantId: tenant.tenantId,
    profileId: tenant.profileId,
    profileVersionId: tenant.versionId,
    rawItemId,
    relevanceScore: 0.8,
    summary: "Pro is now $29",
    createdAt: now,
  });
  await db.insert(schema.digests).values({
    id: digestId,
    tenantId: tenant.tenantId,
    profileId: tenant.profileId,
    profileVersionId: tenant.versionId,
    periodStart: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    periodEnd: now,
    channel: "telegram",
  });
  await db.insert(schema.digestCards).values({
    id: cardId,
    tenantId: tenant.tenantId,
    digestId,
    eventId,
    position: 0,
    headline: "Pro is now $29",
  });

  return cardId;
}
