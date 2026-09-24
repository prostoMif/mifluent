/**
 * The embedding stage: raw items without chunks get chunks and vectors.
 *
 * Free and local, so it runs on everything that was fetched — it is the step
 * that makes the cheap filter after it possible.
 *
 * Identical chunks are embedded once. The same press release lands in many
 * tenants' feeds, and on a one-core server the model is the bottleneck; a
 * chunk whose text hash already has a vector from this model reuses it. Only
 * the vector crosses the tenant line, never the text — and the vector was
 * computed from text this tenant also holds.
 */

import { createHash } from "node:crypto";
import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import { type Chunk, chunkRawItem, chunkText } from "@mifluent/domain";
import type { EmbeddingProvider } from "@mifluent/embeddings";
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";

export interface EmbedItemsOptions {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly provider: EmbeddingProvider;
  /** Items per run. The job re-queues itself while there is more. */
  readonly limit?: number;
}

export interface EmbedItemsResult {
  readonly items: number;
  readonly chunks: number;
  /** Chunks whose vector was found rather than computed. */
  readonly reused: number;
  /** True when the run stopped at `limit` and more items are waiting. */
  readonly hasMore: boolean;
}

interface PendingItem {
  readonly id: string;
  readonly content: string;
  readonly kind: string;
  readonly addedText: string | null;
}

interface PlannedChunk extends Chunk {
  readonly itemId: string;
  readonly ordinal: number;
  readonly hash: string;
}

/** About a minute of CPU on the production server per run. */
const DEFAULT_LIMIT = 100;

export async function embedPendingItems(options: EmbedItemsOptions): Promise<EmbedItemsResult> {
  const { db, tenantId, provider } = options;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const items = await findPendingItems(db, tenantId, limit + 1);
  const batch = items.slice(0, limit);
  const planned = batch.flatMap(planChunks);

  if (planned.length === 0) {
    return { items: 0, chunks: 0, reused: 0, hasMore: false };
  }

  const known = await findKnownVectors(db, provider.model, planned);
  const missing = uniqueByHash(planned.filter((chunk) => !known.has(chunk.hash)));
  const computed = await provider.embedPassage(missing.map((chunk) => chunk.content));

  const vectors = new Map(known);
  missing.forEach((chunk, index) => {
    const vector = computed[index];
    if (vector !== undefined) vectors.set(chunk.hash, Array.from(vector));
  });

  await db.transaction(async (transaction) => {
    for (const chunk of planned) {
      await insertChunk(transaction, { tenantId, model: provider.model, chunk, vectors });
    }
  });

  return {
    items: batch.length,
    chunks: planned.length,
    reused: planned.length - missing.length,
    hasMore: items.length > limit,
  };
}

async function findPendingItems(
  db: Queryable,
  tenantId: string,
  limit: number,
): Promise<PendingItem[]> {
  return db
    .select({
      id: schema.rawItems.id,
      content: schema.rawItems.content,
      kind: schema.rawItems.kind,
      addedText: schema.rawItems.addedText,
    })
    .from(schema.rawItems)
    .where(
      scoped(
        schema.rawItems,
        tenantId,
        // Blank items can never be embedded; without this they would be picked
        // first on every run, forever.
        sql`trim(${schema.rawItems.content}) <> ''`,
        notExists(
          db
            .select({ id: schema.chunks.id })
            .from(schema.chunks)
            .where(eq(schema.chunks.rawItemId, schema.rawItems.id)),
        ),
      ),
    )
    .orderBy(asc(schema.rawItems.fetchedAt))
    .limit(limit);
}

/**
 * The chunks one item will get.
 *
 * A diff that only removed text has nothing "added" to embed, and would sit
 * unembedded forever — so it falls back to its whole content. Losing a
 * feature is news too; the cheap model decides whether it matters.
 */
function planChunks(item: PendingItem): PlannedChunk[] {
  const kind = isItemKind(item.kind) ? item.kind : "article";
  const primary = chunkRawItem({ content: item.content, kind, addedText: item.addedText });
  const chunks = primary.length > 0 ? primary : chunkText(item.content);

  return chunks.map((chunk, ordinal) => ({
    ...chunk,
    itemId: item.id,
    ordinal,
    hash: hashText(chunk.content),
  }));
}

async function findKnownVectors(
  db: Queryable,
  model: string,
  chunks: readonly PlannedChunk[],
): Promise<Map<string, number[]>> {
  const hashes = [...new Set(chunks.map((chunk) => chunk.hash))];

  // Deliberately not tenant-scoped — see the note at the top of this file.
  // Returns vectors keyed by hash, never chunk text.
  const rows = await db
    .selectDistinctOn([schema.chunks.contentHash], {
      hash: schema.chunks.contentHash,
      embedding: schema.embeddings.embedding,
    })
    .from(schema.chunks)
    .innerJoin(schema.embeddings, eq(schema.embeddings.chunkId, schema.chunks.id))
    .where(and(inArray(schema.chunks.contentHash, hashes), eq(schema.embeddings.model, model)));

  const known = new Map<string, number[]>();
  for (const row of rows) {
    if (row.hash !== null) known.set(row.hash, row.embedding);
  }
  return known;
}

interface InsertChunkOptions {
  readonly tenantId: string;
  readonly model: string;
  readonly chunk: PlannedChunk;
  readonly vectors: ReadonlyMap<string, number[]>;
}

async function insertChunk(db: Queryable, options: InsertChunkOptions): Promise<void> {
  const { tenantId, model, chunk, vectors } = options;
  const vector = vectors.get(chunk.hash);
  if (vector === undefined) return;

  const chunkId = uuidv7();
  await db.insert(schema.chunks).values({
    id: chunkId,
    tenantId,
    rawItemId: chunk.itemId,
    ordinal: chunk.ordinal,
    content: chunk.content,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    contentHash: chunk.hash,
  });
  await db.insert(schema.embeddings).values({
    id: uuidv7(),
    tenantId,
    chunkId,
    model,
    embedding: vector,
  });
}

function uniqueByHash(chunks: readonly PlannedChunk[]): PlannedChunk[] {
  const seen = new Set<string>();
  return chunks.filter((chunk) => {
    if (seen.has(chunk.hash)) return false;
    seen.add(chunk.hash);
    return true;
  });
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isItemKind(value: string): value is "article" | "diff" | "job" | "release" {
  return value === "article" || value === "diff" || value === "job" || value === "release";
}
