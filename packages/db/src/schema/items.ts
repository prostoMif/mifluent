/**
 * Raw material and its derivatives: what was fetched, how it was cut up, and
 * the vectors used to compare it against what a tenant cares about.
 *
 * Everything here is machine-generated and regenerable, so it is hard-deleted
 * on a TTL rather than soft-deleted. These are also the three tables that will
 * hold, by a wide margin, the most rows in the system — which is why identifiers
 * are time-ordered and why every index below exists for a query that actually
 * runs, not for a hypothetical one.
 */

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { pageVersions, sources } from "./sources.js";
import { tenants } from "./tenancy.js";

/**
 * Embedding width. intfloat/multilingual-e5-small emits 384 dimensions.
 *
 * Changing this number later means recomputing every stored vector, so it is
 * a constant in one place rather than a literal scattered through the schema.
 */
export const EMBEDDING_DIMENSIONS = 384;

export const rawItems = pgTable(
  "raw_items",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** Stable identifier from the source itself: guid, permalink, message id. */
    externalId: text("external_id"),
    url: text("url"),
    title: text("title"),
    author: text("author"),
    /** Extracted text. Never raw HTML — see the note in sources.ts. */
    content: text("content").notNull(),
    /**
     * SHA-256 of the normalised content. Deduplication happens on this before
     * anything expensive runs: the same press release appears in four feeds.
     */
    contentHash: text("content_hash").notNull(),
    /** When the source says it was published. Often absent, often wrong. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** When we saw it. Always known, and what the digest's "age" is measured from. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /** Anything connector-specific worth keeping: score, subreddit, comment count. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    /** Type of material: article (default), diff, job, release. */
    kind: text("kind").notNull().default("article"),
    /** For diff items, links to the page version that produced it. */
    pageVersionId: uuid("page_version_id").references(() => pageVersions.id, {
      onDelete: "set null",
    }),
    /** For diff items: the text that was added. */
    addedText: text("added_text"),
    /** For diff items: the text that was removed. */
    removedText: text("removed_text"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    // Deduplication lookup. Scoped per tenant: two tenants may legitimately
    // hold the same item, and one must not suppress the other's copy.
    uniqueIndex("raw_items_tenant_hash_unique").on(table.tenantId, table.contentHash),
    index("raw_items_source_fetched_idx").on(table.sourceId, table.fetchedAt),
    index("raw_items_tenant_fetched_idx").on(table.tenantId, table.fetchedAt),
    index("raw_items_page_version_idx").on(table.pageVersionId),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    rawItemId: uuid("raw_item_id")
      .notNull()
      .references(() => rawItems.id, { onDelete: "cascade" }),
    /** Position within the item, from zero. */
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    /**
     * Character offsets into `raw_items.content`. These are what make a verbatim
     * quote checkable later — without them a claim can only be matched by
     * searching, which is both slower and fuzzier than it should be.
     */
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("chunks_item_ordinal_unique").on(table.rawItemId, table.ordinal),
    index("chunks_tenant_idx").on(table.tenantId),
  ],
);

export const embeddings = pgTable(
  "embeddings",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    /** Which model produced this. Vectors from different models never mix. */
    model: text("model").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("embeddings_chunk_model_unique").on(table.chunkId, table.model),
    // HNSW rather than IVFFlat: it needs no training pass and behaves sanely on
    // a table that grows continuously, which is exactly this table. Cosine
    // distance because the vectors are normalised.
    index("embeddings_vector_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("embeddings_tenant_idx").on(table.tenantId),
  ],
);

export const rawItemsRelations = relations(rawItems, ({ many, one }) => ({
  source: one(sources, { fields: [rawItems.sourceId], references: [sources.id] }),
  chunks: many(chunks),
}));

export const chunksRelations = relations(chunks, ({ many, one }) => ({
  rawItem: one(rawItems, { fields: [chunks.rawItemId], references: [rawItems.id] }),
  embeddings: many(embeddings),
}));

export const embeddingsRelations = relations(embeddings, ({ one }) => ({
  chunk: one(chunks, { fields: [embeddings.chunkId], references: [chunks.id] }),
}));
