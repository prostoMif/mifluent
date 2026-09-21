/**
 * The analyst registry and the material it produces.
 *
 * Unlike almost everything else in this schema, these tables carry no
 * `tenant_id`. The registry is curated by the maintainer, shipped in the
 * repository, and identical on every instance — that is the point of it. What
 * *is* tenant-scoped is the link between one tenant's event and an analyst's
 * piece, which lives in `analyst_opinions` at the bottom of this file.
 *
 * The selection rules the registry enforces are in CONTRIBUTING.md. Two of them
 * matter to the schema: analysts must publish in the open, because paywalled
 * material cannot be retold, only linked; and every entry needs a
 * machine-readable feed, because otherwise there is nothing to connect to.
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { aliveOnly, id, softDelete, timestamps } from "./common.js";
import { events } from "./events.js";
import { EMBEDDING_DIMENSIONS } from "./items.js";
import { tenants } from "./tenancy.js";

export const analysts = pgTable(
  "analysts",
  {
    id: id(),
    /** Stable key from the registry file, so re-imports update rather than duplicate. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** What they cover: "payments regulation", "e-commerce logistics". */
    niche: text("niche").notNull(),
    homepageUrl: text("homepage_url"),
    /** Whether they are currently used for matching. Kept rather than deleted. */
    isActive: boolean("is_active").notNull().default(true),
    /** Notes from the quarterly review: who stopped writing, who drifted. */
    reviewNotes: text("review_notes"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [uniqueIndex("analysts_slug_unique").on(table.slug).where(aliveOnly)],
);

export const analystFeeds = pgTable(
  "analyst_feeds",
  {
    id: id(),
    analystId: uuid("analyst_id")
      .notNull()
      .references(() => analysts.id, { onDelete: "cascade" }),
    feedUrl: text("feed_url").notNull(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastErrorMessage: text("last_error_message"),
    ...timestamps,
  },
  (table) => [uniqueIndex("analyst_feeds_url_unique").on(table.feedUrl)],
);

/**
 * A published piece by an analyst.
 *
 * Carries its own embedding rather than going through the tenant-scoped
 * pipeline: this material is shared across every tenant on the instance, so
 * embedding it once and reusing it is both correct and the difference between a
 * cheap feature and an expensive one.
 */
export const analystItems = pgTable(
  "analyst_items",
  {
    id: id(),
    analystId: uuid("analyst_id")
      .notNull()
      .references(() => analysts.id, { onDelete: "cascade" }),
    feedId: uuid("feed_id").references(() => analystFeeds.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    /** Extracted text. Used for matching only — never retold in a digest. */
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("analyst_items_url_unique").on(table.url),
    index("analyst_items_analyst_published_idx").on(table.analystId, table.publishedAt),
    index("analyst_items_vector_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

/**
 * The link between one tenant's event and an analyst's piece.
 *
 * Tenant-scoped because the match is a judgement about *this* tenant's event.
 * If nothing crosses the similarity threshold, no row is written and the card
 * simply has no analyst block — an absent opinion is correct, an invented one is
 * not.
 */
export const analystOpinions = pgTable(
  "analyst_opinions",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    analystItemId: uuid("analyst_item_id")
      .notNull()
      .references(() => analystItems.id, { onDelete: "cascade" }),
    /** Cosine similarity at match time. Kept so the threshold can be retuned. */
    similarity: real("similarity").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("analyst_opinions_event_item_unique").on(table.eventId, table.analystItemId),
    index("analyst_opinions_tenant_idx").on(table.tenantId),
  ],
);

export const analystsRelations = relations(analysts, ({ many }) => ({
  feeds: many(analystFeeds),
  items: many(analystItems),
}));

export const analystItemsRelations = relations(analystItems, ({ one }) => ({
  analyst: one(analysts, { fields: [analystItems.analystId], references: [analysts.id] }),
}));

export const analystOpinionsRelations = relations(analystOpinions, ({ one }) => ({
  event: one(events, { fields: [analystOpinions.eventId], references: [events.id] }),
  item: one(analystItems, {
    fields: [analystOpinions.analystItemId],
    references: [analystItems.id],
  }),
}));
