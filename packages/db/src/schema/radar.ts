/**
 * The public radar's post drafts: one row per radar event that became a
 * draft, so the owner's buttons have something to act on, the daily limit
 * has something to count, and an event is never drafted twice.
 */

import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { events } from "./events.js";

export const radarPosts = pgTable(
  "radar_posts",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** en | ru — the radar profile's language. */
    language: text("language").notNull(),
    /**
     * drafted (sent to the owner) → published | skipped;
     * queued (over the daily limit) → into the weekly round-up draft.
     */
    status: text("status").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("radar_posts_event_unique").on(table.eventId),
    index("radar_posts_language_created_idx").on(table.language, table.createdAt),
    check(
      "radar_posts_status_check",
      sql`${table.status} IN ('drafted', 'queued', 'published', 'skipped')`,
    ),
  ],
);
