/**
 * Digests: what was actually sent, and what it contained.
 *
 * Two decisions are encoded in this file that are easy to lose later.
 *
 * A digest row is written even when nothing passed the filter. Silence reads as
 * a broken pipeline, so an empty morning still produces a message — one that
 * reports how many sources were checked and how many items were rejected, plus
 * the one that came closest and why it missed. That is what `sourcesChecked`,
 * `itemsConsidered` and `nearMisses` are for.
 *
 * A card is stored as separated blocks rather than one blob of prose. Fact,
 * implication, analyst opinion and model interpretation are different kinds of
 * claim with different reliability, and once they are concatenated into a
 * paragraph nobody can tell them apart again — including the person deciding
 * whether to act on it.
 */

import { relations, sql } from "drizzle-orm";
import {
  check,
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
import { id, timestamps } from "./common.js";
import { events } from "./events.js";
import { watchProfiles, watchProfileVersions } from "./profiles.js";
import { tenants } from "./tenancy.js";

/**
 * A line in a digest that is about the watching rather than about an event.
 *
 * `target_quiet` is the "X has been quieter than usual" line. It is a notice
 * rather than a card because a card is an event with facts behind it, and
 * silence has neither.
 */
export type DigestNotice =
  | { readonly code: "baseline_recorded" }
  | { readonly code: "cost_cap_reached" }
  | { readonly code: "target_quiet"; readonly targetName: string };

export const digestStatusEnum = pgEnum("digest_status", ["pending", "delivered", "failed"]);

export const deliveryChannelEnum = pgEnum("delivery_channel", ["telegram", "email", "web_only"]);

export const cardBlockKindEnum = pgEnum("card_block_kind", [
  /** A verified claim with its verbatim quote and a link. */
  "fact",
  /** Why it touches this business. Derived from the profile. */
  "implication",
  /** An independent take, linked rather than retold. */
  "analyst_opinion",
  /** The model's own reading. Always labelled as such in the interface. */
  "model_interpretation",
]);

export const digests = pgTable(
  "digests",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    profileVersionId: uuid("profile_version_id")
      .notNull()
      .references(() => watchProfileVersions.id),
    /** The window this digest covers, in UTC. */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: digestStatusEnum("status").notNull().default("pending"),
    channel: deliveryChannelEnum("channel").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failureReason: text("failure_reason"),

    // --- What the empty-day report is built from -------------------------
    sourcesChecked: integer("sources_checked").notNull().default(0),
    itemsConsidered: integer("items_considered").notNull().default(0),
    /**
     * The two or three items that came closest to the threshold without
     * clearing it, with the reason each was rejected. Shown on a quiet day: it
     * proves the system is alive and makes the filter's logic visible.
     */
    nearMisses: jsonb("near_misses")
      .$type<{ title: string; url: string | null; reason: string }[]>()
      .notNull()
      .default([]),
    /**
     * Service lines the renderer turns into a sentence in the reader's
     * language. Codes rather than text so the digest can be rendered for
     * Telegram and the web alike.
     */
    notices: jsonb("notices").$type<DigestNotice[]>().notNull().default([]),
    ...timestamps,
  },
  (table) => [
    index("digests_profile_period_idx").on(table.profileId, table.periodEnd),
    index("digests_tenant_idx").on(table.tenantId),
    // One digest per profile per window per channel. Guards against a retried
    // job delivering the same morning twice.
    uniqueIndex("digests_profile_period_channel_unique").on(
      table.profileId,
      table.periodStart,
      table.periodEnd,
      table.channel,
    ),
  ],
);

export const digestCards = pgTable(
  "digest_cards",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    digestId: uuid("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Display order within the digest, most significant first. */
    position: integer("position").notNull(),
    /**
     * "event" for one event; "group" when a busy week folds several events
     * about one target into a single card, which then shows the first few
     * facts and says how many more there were.
     */
    kind: text("kind").notNull().default("event"),
    headline: text("headline").notNull(),
    sourceUrl: text("source_url"),
    /** For a group card: events folded in but not shown. */
    moreCount: integer("more_count").notNull().default(0),
    /**
     * How old the underlying change was at delivery time. Shown on the card —
     * "this happened 6 days ago" — because it is the one line that makes the
     * product's promise visible every single morning.
     */
    ageDays: integer("age_days"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("digest_cards_digest_position_unique").on(table.digestId, table.position),
    index("digest_cards_event_idx").on(table.eventId),
    check("digest_cards_kind_check", sql`${table.kind} IN ('event', 'group')`),
  ],
);

export const cardBlocks = pgTable(
  "card_blocks",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => digestCards.id, { onDelete: "cascade" }),
    kind: cardBlockKindEnum("kind").notNull(),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    /** Where this block's claim came from, when it points outward. */
    sourceUrl: text("source_url"),
    /** For `fact` blocks: the verbatim quote, already verified. */
    quote: text("quote"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("card_blocks_card_position_unique").on(table.cardId, table.position),
    index("card_blocks_kind_idx").on(table.kind),
  ],
);

export const digestsRelations = relations(digests, ({ many, one }) => ({
  profile: one(watchProfiles, {
    fields: [digests.profileId],
    references: [watchProfiles.id],
  }),
  cards: many(digestCards),
}));

export const digestCardsRelations = relations(digestCards, ({ many, one }) => ({
  digest: one(digests, { fields: [digestCards.digestId], references: [digests.id] }),
  event: one(events, { fields: [digestCards.eventId], references: [events.id] }),
  blocks: many(cardBlocks),
}));

export const cardBlocksRelations = relations(cardBlocks, ({ one }) => ({
  card: one(digestCards, { fields: [cardBlocks.cardId], references: [digestCards.id] }),
}));
