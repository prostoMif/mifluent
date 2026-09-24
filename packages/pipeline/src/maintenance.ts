/**
 * Daily pruning of what the pipeline leaves behind.
 *
 * The line this file has to hold: **raw material expires, history does not.**
 *
 * A plan's `rawRetentionDays` is the depth of the material — `raw_items`,
 * `chunks`, `embeddings`, `page_versions` — which is regenerable, weighs
 * almost everything, and is what the plan is actually pricing. `events`,
 * `facts`, `digests`, `digest_cards`, `card_blocks`, `user_actions` and
 * `decisions` have no TTL at all. They go when the account goes, and not
 * before: an archive that empties itself after thirty days is not an archive,
 * and a decision log is the one thing here nobody can reconstruct.
 *
 * That rule is not expressible in the schema today. `events.raw_item_id` is
 * `not null` and cascades, so deleting a raw item takes its event, its facts
 * and every card built from them with it. Until a migration makes that column
 * nullable, the deletes below skip any raw item an event still points at —
 * see the note in `pruneExpiredMaterial`.
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import { findTenantPlan } from "@mifluent/domain";
import { and, eq, exists, gt, isNull, lt, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/** From TASK-007: long enough for a weekly digest's near misses and "why didn't I see X". */
export const REJECTION_RETENTION_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PruneCounts {
  readonly rawItems: number;
  readonly chunks: number;
  readonly pageVersions: number;
}

export async function pruneRejections(db: Queryable, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REJECTION_RETENTION_DAYS * DAY_MS);
  const removed = await db
    .delete(schema.rejections)
    .where(lt(schema.rejections.occurredAt, cutoff))
    .returning({ id: schema.rejections.id });
  return removed.length;
}

/**
 * Delete raw material older than the tenant's plan keeps it.
 *
 * Three tables, in the order that keeps the foreign keys quiet: chunks (and
 * their embeddings, by cascade), then the raw items no event refers to, then
 * old page snapshots.
 *
 * A raw item that produced an event stays. It is the only way to keep the
 * event without making `events.raw_item_id` nullable first, and losing the
 * event would take the digest card and the decision written against it.
 * Chunks and vectors are pruned either way, and they are the bulk of it.
 */
export async function pruneExpiredMaterial(
  db: Queryable,
  now: Date = new Date(),
): Promise<PruneCounts> {
  const tenants = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(isNull(schema.tenants.deletedAt));

  let rawItems = 0;
  let chunks = 0;
  let pageVersions = 0;

  for (const tenant of tenants) {
    const { limits } = await findTenantPlan(db, tenant.id);
    if (limits.rawRetentionDays === 0) continue;

    const cutoff = new Date(now.getTime() - limits.rawRetentionDays * DAY_MS);
    chunks += await pruneChunks(db, tenant.id, cutoff);
    rawItems += await pruneRawItems(db, tenant.id, cutoff);
    pageVersions += await prunePageVersions(db, tenant.id, cutoff);
  }

  return { rawItems, chunks, pageVersions };
}

async function pruneChunks(db: Queryable, tenantId: string, cutoff: Date): Promise<number> {
  const removed = await db
    .delete(schema.chunks)
    .where(scoped(schema.chunks, tenantId, lt(schema.chunks.createdAt, cutoff)))
    .returning({ id: schema.chunks.id });
  return removed.length;
}

async function pruneRawItems(db: Queryable, tenantId: string, cutoff: Date): Promise<number> {
  const removed = await db
    .delete(schema.rawItems)
    .where(
      scoped(
        schema.rawItems,
        tenantId,
        lt(schema.rawItems.fetchedAt, cutoff),
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.events)
            .where(eq(schema.events.rawItemId, schema.rawItems.id)),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.eventItems)
            .where(eq(schema.eventItems.rawItemId, schema.rawItems.id)),
        ),
      ),
    )
    .returning({ id: schema.rawItems.id });
  return removed.length;
}

/**
 * Old page snapshots, never the newest one of a source: that one is the
 * baseline the next diff compares against, and deleting it would report a
 * whole pricing page as "added" the next morning.
 */
async function prunePageVersions(db: Queryable, tenantId: string, cutoff: Date): Promise<number> {
  const newer = alias(schema.pageVersions, "newer_version");

  const removed = await db
    .delete(schema.pageVersions)
    .where(
      scoped(
        schema.pageVersions,
        tenantId,
        lt(schema.pageVersions.fetchedAt, cutoff),
        exists(
          db
            .select({ one: sql`1` })
            .from(newer)
            .where(
              and(
                eq(newer.sourceId, schema.pageVersions.sourceId),
                gt(newer.fetchedAt, schema.pageVersions.fetchedAt),
              ),
            ),
        ),
      ),
    )
    .returning({ id: schema.pageVersions.id });
  return removed.length;
}
