/**
 * Events and facts — the output of the pipeline.
 *
 * An event is a piece of material the classifier kept: something changed, and it
 * plausibly touches this tenant. A fact is a single claim extracted from that
 * event by the expensive model, and it only exists if its quote was found
 * verbatim in the source.
 *
 * That last point is the load-bearing one. `quote`, `quoteStartOffset` and
 * `quoteEndOffset` are not decoration — they are checked by exact string match
 * against `raw_items.content` before a row is written. A claim whose quote
 * cannot be located is dropped, not softened. This is the defence against both
 * hallucination and prompt injection, and weakening it to make a test pass
 * removes the reason to trust anything the product says.
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { rawItems } from "./items.js";
import { watchProfiles, watchProfileVersions, watchTargets } from "./profiles.js";
import { tenants } from "./tenancy.js";

export const events = pgTable(
  "events",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    /**
     * Which version of the profile selected this. Without it, "why did this
     * appear in my digest" becomes unanswerable once the profile changes.
     */
    profileVersionId: uuid("profile_version_id")
      .notNull()
      .references(() => watchProfileVersions.id),
    rawItemId: uuid("raw_item_id")
      .notNull()
      .references(() => rawItems.id, { onDelete: "cascade" }),
    /** Which watched thing this is about, when that is known. */
    targetId: uuid("target_id").references(() => watchTargets.id, {
      onDelete: "set null",
    }),
    /** Classifier output, 0..1. Stored so thresholds can be retuned later. */
    relevanceScore: real("relevance_score").notNull(),
    /** One line: what changed. Written by the model from verified facts. */
    summary: text("summary").notNull(),
    /** Why it touches this business. Tied to the profile's own description. */
    implication: text("implication"),
    /** Kind of change: price, plan, feature, policy, hiring, copy, incident, news, other. */
    kind: text("kind"),
    /** Whether this event requires immediate attention. */
    isUrgent: boolean("is_urgent").notNull().default(false),
    /** When the underlying change happened, as best as can be established. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    // The digest builder's query: this profile, this window, best first.
    index("events_profile_created_idx").on(table.profileId, table.createdAt),
    index("events_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("events_target_idx").on(table.targetId),
    index("events_raw_item_idx").on(table.rawItemId),
  ],
);

export const facts = pgTable(
  "facts",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The claim, in the model's words. */
    statement: text("statement").notNull(),
    /** The supporting text, character for character as it appears in the source. */
    quote: text("quote").notNull(),
    /** Offsets into `raw_items.content`, so the quote can be re-verified cheaply. */
    quoteStartOffset: integer("quote_start_offset").notNull(),
    quoteEndOffset: integer("quote_end_offset").notNull(),
    /**
     * Whether the second, cheaper verification pass agreed with the claim.
     * Recorded rather than enforced so that disagreement rates can be measured
     * — a verifier that never disagrees is not doing anything.
     */
    verified: jsonb("verified").$type<{ pass: boolean; model: string }>(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("facts_event_idx").on(table.eventId)],
);

export const eventItems = pgTable(
  "event_items",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    rawItemId: uuid("raw_item_id")
      .notNull()
      .references(() => rawItems.id, { onDelete: "cascade" }),
    /** True for the primary item that triggered the event. */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("event_items_event_raw_item_unique").on(table.eventId, table.rawItemId),
    index("event_items_tenant_idx").on(table.tenantId),
    index("event_items_raw_item_idx").on(table.rawItemId),
  ],
);

export const eventItemsRelations = relations(eventItems, ({ one }) => ({
  event: one(events, { fields: [eventItems.eventId], references: [events.id] }),
  rawItem: one(rawItems, { fields: [eventItems.rawItemId], references: [rawItems.id] }),
}));

export const eventsRelations = relations(events, ({ many, one }) => ({
  profile: one(watchProfiles, {
    fields: [events.profileId],
    references: [watchProfiles.id],
  }),
  rawItem: one(rawItems, { fields: [events.rawItemId], references: [rawItems.id] }),
  target: one(watchTargets, { fields: [events.targetId], references: [watchTargets.id] }),
  facts: many(facts),
  items: many(eventItems),
}));

export const factsRelations = relations(facts, ({ one }) => ({
  event: one(events, { fields: [facts.eventId], references: [events.id] }),
}));
