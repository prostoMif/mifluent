/**
 * Clustering: is this new event the same story as one already written up?
 *
 * The same announcement arrives as the company's post, three news articles
 * and a Reddit thread. AGENTS.md: an event is a cluster of items, never one
 * event per item. So before the expensive model runs on a new event, it is
 * compared with the profile's events from the last 72 hours; if one is close
 * enough, the new item joins that event and the new event is removed.
 *
 * Doing this before extraction rather than after is the whole point: the
 * expensive model then runs once per story, not once per reprint.
 */

import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import { centroid, cosineSimilarity } from "@mifluent/embeddings";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";

export interface ClusterCandidate {
  readonly eventId: string;
  readonly centroid: ArrayLike<number>;
}

/** Three days: long enough for the reprints of one story, short enough not to merge a sequel. */
export const CLUSTER_WINDOW_HOURS = 72;

/** The existing event this one belongs to, or null. Pure; exported for tests. */
export function findClusterAnchor(
  vector: ArrayLike<number>,
  candidates: readonly ClusterCandidate[],
  threshold: number,
): { readonly eventId: string; readonly similarity: number } | null {
  let best: { eventId: string; similarity: number } | null = null;

  for (const candidate of candidates) {
    const similarity = cosineSimilarity(vector, candidate.centroid);
    if (similarity > threshold && (best === null || similarity > best.similarity)) {
      best = { eventId: candidate.eventId, similarity };
    }
  }

  return best;
}

export interface ClusterInput {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly profileId: string;
  readonly eventId: string;
  readonly rawItemId: string;
  readonly isUrgent: boolean;
  readonly createdAt: Date;
  readonly model: string;
  readonly threshold: number;
}

/**
 * Merge the event into an earlier one if they are the same story.
 *
 * Only events that already have facts are candidates: they are the ones that
 * survived extraction, and an anchor that later fails quote verification would
 * take the merged items down with it.
 */
export async function clusterEvent(
  input: ClusterInput,
): Promise<{ readonly anchorId: string; readonly similarity: number } | null> {
  const { db, tenantId } = input;
  const own = await itemCentroids(db, tenantId, input.model, [input.rawItemId]);
  const vector = own.get(input.rawItemId);
  if (vector === undefined) return null;

  const since = new Date(input.createdAt.getTime() - CLUSTER_WINDOW_HOURS * 60 * 60 * 1000);
  const recent = await db
    .select({ eventId: schema.events.id, rawItemId: schema.events.rawItemId })
    .from(schema.events)
    .where(
      scoped(
        schema.events,
        tenantId,
        eq(schema.events.profileId, input.profileId),
        ne(schema.events.id, input.eventId),
        gte(schema.events.createdAt, since),
        sql`EXISTS (SELECT 1 FROM ${schema.facts} WHERE ${schema.facts.eventId} = ${schema.events.id})`,
      ),
    );

  if (recent.length === 0) return null;

  const centroids = await itemCentroids(
    db,
    tenantId,
    input.model,
    recent.map((row) => row.rawItemId),
  );
  const candidates = recent.flatMap((row) => {
    const candidate = centroids.get(row.rawItemId);
    return candidate === undefined ? [] : [{ eventId: row.eventId, centroid: candidate }];
  });

  const anchor = findClusterAnchor(vector, candidates, input.threshold);
  if (anchor === null) return null;

  await mergeInto(db, input, anchor.eventId);
  return { anchorId: anchor.eventId, similarity: anchor.similarity };
}

async function mergeInto(db: Queryable, input: ClusterInput, anchorId: string): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction
      .insert(schema.eventItems)
      .values({
        id: uuidv7(),
        tenantId: input.tenantId,
        eventId: anchorId,
        rawItemId: input.rawItemId,
        isPrimary: false,
      })
      .onConflictDoNothing();

    if (input.isUrgent) {
      await transaction
        .update(schema.events)
        .set({ isUrgent: true })
        .where(scoped(schema.events, input.tenantId, eq(schema.events.id, anchorId)));
    }

    await transaction
      .delete(schema.events)
      .where(scoped(schema.events, input.tenantId, eq(schema.events.id, input.eventId)));
  });
}

/** The normalised mean of each item's chunk vectors. */
async function itemCentroids(
  db: Queryable,
  tenantId: string,
  model: string,
  rawItemIds: readonly string[],
): Promise<Map<string, Float32Array>> {
  const rows = await db
    .select({ itemId: schema.chunks.rawItemId, vector: schema.embeddings.embedding })
    .from(schema.chunks)
    .innerJoin(schema.embeddings, eq(schema.embeddings.chunkId, schema.chunks.id))
    .where(
      scoped(
        schema.chunks,
        tenantId,
        and(eq(schema.embeddings.model, model), inArray(schema.chunks.rawItemId, [...rawItemIds])),
      ),
    );

  const grouped = new Map<string, number[][]>();
  for (const row of rows) {
    grouped.set(row.itemId, [...(grouped.get(row.itemId) ?? []), row.vector]);
  }

  return new Map([...grouped].map(([itemId, vectors]) => [itemId, centroid(vectors)]));
}
