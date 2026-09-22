/**
 * Embedding job processor.
 *
 * Processes items:embed jobs - finds raw items without chunks for a tenant,
 * chunks them, computes embeddings, and stores chunks + embeddings.
 */

import { type Database, schema } from "@mifluent/db";
import { chunkRawItem } from "@mifluent/domain";
import { type EmbeddingProvider, getEmbeddingProvider } from "@mifluent/embeddings";
import { sql } from "drizzle-orm";

const BATCH_SIZE = 32;

export async function processEmbedJob(
  db: Database,
  tenantId: string,
  limit: number = 100,
  provider?: EmbeddingProvider,
): Promise<{ embedded: number; chunks: number }> {
  const embedder = provider ?? getEmbeddingProvider({ logger: undefined });

  // Find raw items that don't have chunks yet
  const items = await db
    .select({
      id: schema.rawItems.id,
      content: schema.rawItems.content,
      kind: schema.rawItems.kind,
      addedText: schema.rawItems.addedText,
      removedText: schema.rawItems.removedText,
    })
    .from(schema.rawItems)
    .where(
      sql`${schema.rawItems.tenantId} = ${tenantId} AND NOT EXISTS (
        SELECT 1 FROM ${schema.chunks} WHERE ${schema.chunks.rawItemId} = ${schema.rawItems.id}
      )`,
    )
    .limit(limit);

  if (items.length === 0) {
    return { embedded: 0, chunks: 0 };
  }

  let totalChunks = 0;
  let totalEmbedded = 0;

  // Process items in batches
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    for (const item of batch) {
      const chunks = chunkRawItem({
        content: item.content,
        kind: item.kind as "article" | "diff" | "job" | "release",
        addedText: item.addedText,
        removedText: item.removedText,
      });

      if (chunks.length === 0) continue;

      // Check for existing embeddings by content hash
      const chunkTexts = chunks.map((c) => c.content);
      const embeddings = await embedder.embedPassage(chunkTexts);

      // Insert chunks and embeddings in a transaction
      await db.transaction(async (tx) => {
        for (let j = 0; j < chunks.length; j++) {
          const chunk = chunks[j];
          const embedding = embeddings[j];
          if (!chunk || !embedding) continue;

          const [insertedChunk] = await tx
            .insert(schema.chunks)
            .values({
              id: sql`gen_random_uuid()`,
              tenantId,
              rawItemId: item.id,
              ordinal: j,
              content: chunk.content,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
            })
            .returning({ id: schema.chunks.id });

          if (!insertedChunk) continue;

          await tx.insert(schema.embeddings).values({
            id: sql`gen_random_uuid()`,
            tenantId,
            chunkId: insertedChunk.id,
            model: embedder.model,
            embedding: Array.from(embedding),
          });

          totalChunks++;
        }
      });

      totalEmbedded++;
    }
  }

  return { embedded: totalEmbedded, chunks: totalChunks };
}
