/**
 * What the daily prune may and may not delete, against the real foreign keys.
 *
 * This is the one the unit test cannot make. `pruneExpiredMaterial` never
 * mentioned `events` — it deleted `raw_items`, and `events.raw_item_id`
 * cascades. The damage was entirely in the schema, so a test that watches
 * which tables the job names would have passed while a month of history went
 * with the raw text it came from.
 *
 * The wiki's rule, in one line: TTL applies to raw material, never to history.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "@mifluent/db";
import { schema } from "@mifluent/db";
import { recordDecision } from "@mifluent/domain";
import { pruneExpiredMaterial } from "@mifluent/pipeline";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestTenant,
  deleteTestTenants,
  getTestDatabase,
  hasTestDatabase,
  type TestTenant,
} from "./database.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Past the free plan's thirty days, so everything seeded here is expired. */
const LONG_AGO = new Date(Date.now() - 100 * DAY_MS);

interface Seeded {
  readonly eventId: string;
  readonly cardId: string;
  readonly keptRawItemId: string;
  readonly looseRawItemId: string;
  readonly newestVersionId: string;
  readonly olderVersionId: string;
}

describe.skipIf(!hasTestDatabase)("pruneExpiredMaterial", () => {
  let db: Database;
  let tenant: TestTenant;
  let seeded: Seeded;

  beforeAll(async () => {
    db = await getTestDatabase();
    tenant = await createTestTenant(db);
    seeded = await seedExpiredHistory(db, tenant);
    await recordDecision(db, {
      tenantId: tenant.tenantId,
      cardId: seeded.cardId,
      text: "holding our price and adding a cheaper tier",
    });

    await pruneExpiredMaterial(db, new Date());
  }, 60_000);

  afterAll(async () => {
    await deleteTestTenants(db, [tenant.tenantId]);
  });

  it("keeps the event, its facts and its card", async () => {
    expect(
      await ids(
        db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(eq(schema.events.id, seeded.eventId)),
      ),
    ).toHaveLength(1);
    expect(
      await ids(
        db
          .select({ id: schema.digestCards.id })
          .from(schema.digestCards)
          .where(eq(schema.digestCards.id, seeded.cardId)),
      ),
    ).toHaveLength(1);
    expect(
      await ids(
        db
          .select({ id: schema.facts.id })
          .from(schema.facts)
          .where(eq(schema.facts.eventId, seeded.eventId)),
      ),
    ).toHaveLength(1);
    expect(
      await ids(
        db
          .select({ id: schema.cardBlocks.id })
          .from(schema.cardBlocks)
          .where(eq(schema.cardBlocks.cardId, seeded.cardId)),
      ),
    ).toHaveLength(1);
  });

  it("keeps the action log and the decision written against the card", async () => {
    expect(
      await ids(
        db
          .select({ id: schema.userActions.id })
          .from(schema.userActions)
          .where(eq(schema.userActions.cardId, seeded.cardId)),
      ),
    ).toHaveLength(1);
    expect(
      await ids(
        db
          .select({ id: schema.decisions.id })
          .from(schema.decisions)
          .where(eq(schema.decisions.profileId, tenant.profileId)),
      ),
    ).toHaveLength(1);
  });

  it("keeps the raw item an event still points at", async () => {
    // Only until `events.raw_item_id` can be null — see the note in
    // `maintenance.ts`. Until then this is what keeps the event alive.
    expect(
      await ids(
        db
          .select({ id: schema.rawItems.id })
          .from(schema.rawItems)
          .where(eq(schema.rawItems.id, seeded.keptRawItemId)),
      ),
    ).toHaveLength(1);
  });

  it("deletes expired raw material nothing points at", async () => {
    expect(
      await ids(
        db
          .select({ id: schema.rawItems.id })
          .from(schema.rawItems)
          .where(eq(schema.rawItems.id, seeded.looseRawItemId)),
      ),
    ).toEqual([]);
  });

  it("deletes expired chunks and their vectors either way", async () => {
    // The bulk of the weight, and no event refers to a chunk.
    expect(
      await ids(
        db
          .select({ id: schema.chunks.id })
          .from(schema.chunks)
          .where(eq(schema.chunks.tenantId, tenant.tenantId)),
      ),
    ).toEqual([]);
  });

  it("keeps the newest page snapshot and drops the ones behind it", async () => {
    // The newest is the baseline the next diff compares against; deleting it
    // would report a whole pricing page as "added" the next morning.
    const remaining = await ids(
      db
        .select({ id: schema.pageVersions.id })
        .from(schema.pageVersions)
        .where(eq(schema.pageVersions.tenantId, tenant.tenantId)),
    );

    expect(remaining).toEqual([seeded.newestVersionId]);
  });
});

/** The ids a query returns. Keeps each assertion to one readable line. */
async function ids(query: PromiseLike<{ id: string }[]>): Promise<string[]> {
  return (await query).map((row) => row.id);
}

async function seedExpiredHistory(db: Database, tenant: TestTenant): Promise<Seeded> {
  const sourceId = randomUUID();
  const keptRawItemId = randomUUID();
  const looseRawItemId = randomUUID();
  const chunkId = randomUUID();
  const eventId = randomUUID();
  const digestId = randomUUID();
  const cardId = randomUUID();
  const newestVersionId = randomUUID();
  const olderVersionId = randomUUID();

  await db.insert(schema.sources).values({
    id: sourceId,
    tenantId: tenant.tenantId,
    profileId: tenant.profileId,
    kind: "diff",
    label: "their pricing",
    locator: `https://example.com/${sourceId}/pricing`,
  });

  await db.insert(schema.rawItems).values([
    {
      id: keptRawItemId,
      tenantId: tenant.tenantId,
      sourceId,
      content: "Their Pro plan is now $29 per month.",
      contentHash: keptRawItemId,
      fetchedAt: LONG_AGO,
    },
    {
      id: looseRawItemId,
      tenantId: tenant.tenantId,
      sourceId,
      content: "Something nothing was ever made of.",
      contentHash: looseRawItemId,
      fetchedAt: LONG_AGO,
    },
  ]);

  await db.insert(schema.chunks).values({
    id: chunkId,
    tenantId: tenant.tenantId,
    rawItemId: keptRawItemId,
    ordinal: 0,
    content: "Their Pro plan is now $29 per month.",
    startOffset: 0,
    endOffset: 36,
    createdAt: LONG_AGO,
  });

  await db.insert(schema.events).values({
    id: eventId,
    tenantId: tenant.tenantId,
    profileId: tenant.profileId,
    profileVersionId: tenant.versionId,
    rawItemId: keptRawItemId,
    relevanceScore: 0.8,
    summary: "Pro is now $29",
    createdAt: LONG_AGO,
  });
  await db.insert(schema.eventItems).values({
    id: randomUUID(),
    tenantId: tenant.tenantId,
    eventId,
    rawItemId: keptRawItemId,
    isPrimary: true,
  });
  await db.insert(schema.facts).values({
    id: randomUUID(),
    tenantId: tenant.tenantId,
    eventId,
    statement: "Pro is $29",
    quote: "Pro plan is now $29 per month",
    quoteStartOffset: 6,
    quoteEndOffset: 35,
  });

  await db.insert(schema.digests).values({
    id: digestId,
    tenantId: tenant.tenantId,
    profileId: tenant.profileId,
    profileVersionId: tenant.versionId,
    periodStart: new Date(LONG_AGO.getTime() - 7 * DAY_MS),
    periodEnd: LONG_AGO,
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
  await db.insert(schema.cardBlocks).values({
    id: randomUUID(),
    tenantId: tenant.tenantId,
    cardId,
    kind: "fact",
    position: 0,
    content: "Pro is $29",
    quote: "Pro plan is now $29 per month",
  });
  await db.insert(schema.userActions).values({
    id: randomUUID(),
    tenantId: tenant.tenantId,
    kind: "influenced",
    cardId,
    eventId,
    surface: "telegram",
    occurredAt: LONG_AGO,
  });

  await db.insert(schema.pageVersions).values([
    {
      id: olderVersionId,
      tenantId: tenant.tenantId,
      sourceId,
      contentHash: `older-${olderVersionId}`,
      extractedText: "Pro $19",
      fetchedAt: new Date(LONG_AGO.getTime() - DAY_MS),
    },
    {
      id: newestVersionId,
      tenantId: tenant.tenantId,
      sourceId,
      contentHash: `newest-${newestVersionId}`,
      extractedText: "Pro $29",
      fetchedAt: LONG_AGO,
    },
  ]);

  return {
    eventId,
    cardId,
    keptRawItemId,
    looseRawItemId,
    newestVersionId,
    olderVersionId,
  };
}
