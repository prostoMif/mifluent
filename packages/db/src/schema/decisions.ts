/**
 * What the reader decided.
 *
 * A digest card says what changed; this table says what the person did about
 * it. That is the one thing in the system nobody else can reconstruct — the
 * events came from public sources, but the reasoning did not — and it cannot
 * be collected retroactively, which is why the table exists before the page
 * that will read it.
 *
 * Two consequences follow, and both are load-bearing:
 *
 * - **Never pruned.** Unlike `raw_items` and `user_actions`, a decision has no
 *   TTL. It goes only when the account goes. See `pruneExpiredMaterial`.
 * - **Never leaves the instance.** `text` is the most sensitive column in the
 *   product: it is strategy, written in the person's own words. It is not
 *   logged, not sent to a model, and not counted in telemetry.
 *
 * The links to the event and the target are `set null` rather than `cascade`:
 * losing the change that prompted a decision must not lose the decision.
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { events } from "./events.js";
import { watchProfiles, watchTargets } from "./profiles.js";
import { tenants } from "./tenancy.js";

/**
 * One line typed into a chat window on a phone. Long enough for a sentence
 * with its reason, short enough that nobody writes a memo into a text field
 * that has no editor.
 */
export const MAXIMUM_DECISION_LENGTH = 1_000;

export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    /** The change that prompted it, while that change is still on record. */
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    /** Which watched thing it was about — the axis the target page reads by. */
    targetId: uuid("target_id").references(() => watchTargets.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    /** Optional reminder to look at this decision again. Not yet set anywhere. */
    revisitAt: timestamp("revisit_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("decisions_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("decisions_target_created_idx").on(table.targetId, table.createdAt),
    index("decisions_profile_created_idx").on(table.profileId, table.createdAt),
  ],
);

export const decisionsRelations = relations(decisions, ({ one }) => ({
  profile: one(watchProfiles, {
    fields: [decisions.profileId],
    references: [watchProfiles.id],
  }),
  event: one(events, { fields: [decisions.eventId], references: [events.id] }),
  target: one(watchTargets, { fields: [decisions.targetId], references: [watchTargets.id] }),
}));
