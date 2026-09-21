/**
 * Sources: where material comes from, and the health of each one.
 *
 * Sources break constantly — a feed moves, markup changes, an API tightens its
 * limits. So failure state is first-class here rather than something inferred
 * from an empty result: `consecutiveFailures`, `lastErrorAt` and a status the
 * interface can show. A source that quietly stopped working looks exactly like a
 * quiet week, and that confusion is what makes people leave.
 */

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aliveOnly, id, softDelete, timestamps } from "./common.js";
import { watchProfiles } from "./profiles.js";
import { tenants } from "./tenancy.js";

export const sourceKindEnum = pgEnum("source_kind", [
  "rss",
  "reddit",
  "hacker_news",
  "google_news",
  "email_inbox",
  "page_diff",
]);

export const sourceStatusEnum = pgEnum("source_status", [
  "active",
  "paused",
  /** Repeated failures. Still listed, no longer polled on schedule. */
  "broken",
]);

export const sources = pgTable(
  "sources",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    kind: sourceKindEnum("kind").notNull(),
    status: sourceStatusEnum("status").notNull().default("active"),
    label: text("label").notNull(),
    /**
     * The feed URL, subreddit, search query or inbox address. Shape depends on
     * `kind`; the connector validates it. Null for kinds that carry everything
     * in `config`.
     */
    locator: text("locator"),
    /** Connector-specific settings, validated by that connector's Zod schema. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    /** Minutes between polls. Per source: a changelog is not a news feed. */
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(60),
    /**
     * The validators the server handed out on the last successful poll, sent
     * back on the next one so an unchanged feed can answer 304 with no body.
     *
     * Stored as text and named for the header rather than with the usual `_at`
     * suffix, because neither is a timestamp we own: an ETag is an opaque
     * string, and Last-Modified is whatever date format that server writes.
     * Parsing them into `timestamptz` and formatting them back would be work
     * done for the privilege of getting it subtly wrong.
     */
    etag: text("etag"),
    lastModifiedHeader: text("last_modified_header"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastErrorMessage: text("last_error_message"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("sources_profile_idx").on(table.profileId),
    index("sources_tenant_idx").on(table.tenantId),
    // The scheduler's working query: active sources due for a poll.
    index("sources_due_idx").on(table.status, table.lastPolledAt),
    uniqueIndex("sources_profile_kind_locator_unique")
      .on(table.profileId, table.kind, table.locator)
      .where(aliveOnly),
  ],
);

/**
 * Failure history, kept separately from the current status so a pattern is
 * visible: a source failing every third poll is a different problem from one
 * that died on Tuesday.
 *
 * Machine-generated, so hard-deleted on a TTL rather than soft-deleted.
 */
export const sourceErrors = pgTable(
  "source_errors",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** Machine-readable: the AppError code from the failed fetch. */
    code: text("code").notNull(),
    message: text("message").notNull(),
    httpStatus: integer("http_status"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("source_errors_source_occurred_idx").on(table.sourceId, table.occurredAt)],
);

/**
 * Stored page snapshots for diff sources.
 *
 * Only the extracted text is kept, not the raw HTML: HTML changes on every load
 * because of timestamps, session identifiers and ad slots, and diffing it
 * produces noise on every poll. The number of retained versions is capped —
 * this is the one table that grows without limit if left alone.
 */
export const pageVersions = pgTable(
  "page_versions",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** SHA-256 of the extracted text. Identical hash means no poll-time work. */
    contentHash: text("content_hash").notNull(),
    extractedText: text("extracted_text").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("page_versions_source_fetched_idx").on(table.sourceId, table.fetchedAt),
    uniqueIndex("page_versions_source_hash_unique").on(table.sourceId, table.contentHash),
  ],
);

export const sourcesRelations = relations(sources, ({ many, one }) => ({
  profile: one(watchProfiles, {
    fields: [sources.profileId],
    references: [watchProfiles.id],
  }),
  errors: many(sourceErrors),
  pageVersions: many(pageVersions),
}));
