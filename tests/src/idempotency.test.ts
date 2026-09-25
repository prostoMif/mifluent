/**
 * Job idempotency, against a real database — the third area
 * `docs/code-style.md` calls non-optional, and the one with no coverage at
 * all until now.
 *
 * Every job in the cascade can run twice: pg-boss retries, an hourly tick
 * fires while the last one is still finishing, a worker restarts mid-batch.
 * Running twice must not produce two digests, two copies of an item, or two
 * charges for the same work. None of that is provable without a server: the
 * guarantees live in unique indexes and in `where` clauses.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "@mifluent/db";
import { schema } from "@mifluent/db";
import { buildPeriodDigest } from "@mifluent/digest";
import { recordPolledItems } from "@mifluent/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestTenant,
  deleteTestTenants,
  getTestDatabase,
  hasTestDatabase,
  type TestTenant,
} from "./database.js";

describe.skipIf(!hasTestDatabase)("job idempotency", () => {
  let db: Database;
  let tenant: TestTenant;

  beforeAll(async () => {
    db = await getTestDatabase();
    tenant = await createTestTenant(db);
  }, 60_000);

  afterAll(async () => {
    await deleteTestTenants(db, [tenant.tenantId]);
  });

  it("stores a polled item once however often the poll is repeated", async () => {
    const sourceId = await seedSource(db, tenant);
    const item = {
      fingerprint: `fingerprint-${randomUUID()}`,
      externalId: "guid-1",
      url: "https://example.com/post",
      title: "They raised Pro to $29",
      author: null,
      content: "Their Pro plan is now $29 per month.",
      publishedAt: new Date(),
    };

    const first = await recordPolledItems({
      db,
      tenantId: tenant.tenantId,
      sourceId,
      items: [item],
    });
    const second = await recordPolledItems({
      db,
      tenantId: tenant.tenantId,
      sourceId,
      items: [item],
    });

    expect(first.stored).toBe(1);
    expect(second.stored).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(await countRawItems(db, sourceId)).toBe(1);
  });

  it("returns the digest it already built instead of building a second", async () => {
    const context = {
      db,
      tenantId: tenant.tenantId,
      profileId: tenant.profileId,
      defaults: { timezone: "UTC", hour: 8 },
      isCostCapReached: false,
    };

    const first = await buildPeriodDigest(context, new Date());
    const retried = await buildPeriodDigest(context, new Date());
    // A minute later: still the same hour, so still the same digest.
    const laterInTheHour = await buildPeriodDigest(context, new Date(Date.now() + 60_000));

    expect(first.isNew).toBe(true);
    expect(retried).toMatchObject({ digestId: first.digestId, isNew: false });
    expect(laterInTheHour).toMatchObject({ digestId: first.digestId, isNew: false });
    expect(await countDigests(db, tenant.profileId)).toBe(1);
  });
});

async function seedSource(db: Database, tenant: TestTenant): Promise<string> {
  const sourceId = randomUUID();
  await db.insert(schema.sources).values({
    id: sourceId,
    tenantId: tenant.tenantId,
    profileId: tenant.profileId,
    kind: "rss",
    label: "seed",
    locator: `https://example.com/${sourceId}`,
  });
  return sourceId;
}

async function countRawItems(db: Database, sourceId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.rawItems.id })
    .from(schema.rawItems)
    .where(eq(schema.rawItems.sourceId, sourceId));
  return rows.length;
}

async function countDigests(db: Database, profileId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.digests.id })
    .from(schema.digests)
    .where(eq(schema.digests.profileId, profileId));
  return rows.length;
}
