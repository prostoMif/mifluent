/**
 * Two logs that have to exist from the first commit, because neither can be
 * reconstructed afterwards.
 *
 * `user_actions` is the training signal for the significance classifier. Every
 * save, dismiss and "not relevant" is a labelled example. Start collecting it in
 * month three and months one and two are simply gone.
 *
 * `operation_costs` is how the question "what does one user actually cost per
 * month" gets a number instead of an estimate. Recorded per pipeline step, so
 * an expensive answer can be traced to the step responsible rather than
 * guessed at.
 *
 * Both are machine-generated: hard-deleted on a TTL, no soft-delete flag.
 */

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { id } from "./common.js";
import { digestCards } from "./digests.js";
import { events } from "./events.js";
import { rawItems } from "./items.js";
import { watchProfiles } from "./profiles.js";
import { tenants } from "./tenancy.js";

export const userActionKindEnum = pgEnum("user_action_kind", [
  "saved",
  "dismissed",
  "copied",
  "opened_source",
  "marked_irrelevant",
  "card_viewed",
  "not_following_target",
  "not_important",
]);

export const pipelineStepEnum = pgEnum("pipeline_step", [
  /** Onboarding: reading a site to propose what to watch. */
  "discover",
  "fetch",
  "embed",
  "classify",
  "extract",
  "verify",
  "match",
  "compose",
]);

export const userActions = pgTable(
  "user_actions",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * Who did it. Cleared on account deletion rather than cascaded: the action
     * is training data for the classifier and stays useful without knowing
     * whose it was.
     */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    kind: userActionKindEnum("kind").notNull(),
    /** What was acted on. Both nullable: actions can arrive from Telegram. */
    cardId: uuid("card_id").references(() => digestCards.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    /** Where it came from: "web", "telegram", "email". */
    surface: text("surface").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("user_actions_tenant_occurred_idx").on(table.tenantId, table.occurredAt),
    index("user_actions_event_idx").on(table.eventId),
    // The classifier's training query: every labelled example of a given kind.
    index("user_actions_kind_idx").on(table.kind, table.occurredAt),
  ],
);

export const operationCosts = pgTable(
  "operation_costs",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    step: pipelineStepEnum("step").notNull(),
    /** Empty for local steps such as embedding on this machine. */
    model: text("model"),
    provider: text("provider"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /**
     * Cost in USD. `numeric` rather than a float: these get summed for a monthly
     * total, and floating-point drift in money is a bug nobody enjoys finding.
     */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    durationMs: integer("duration_ms"),
    /** What this step was working on, for tracing a spike back to a source. */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The daily spend query, and the basis of the hard daily cap.
    index("operation_costs_tenant_occurred_idx").on(table.tenantId, table.occurredAt),
    index("operation_costs_step_idx").on(table.step),
  ],
);

export const userActionsRelations = relations(userActions, ({ one }) => ({
  card: one(digestCards, { fields: [userActions.cardId], references: [digestCards.id] }),
  event: one(events, { fields: [userActions.eventId], references: [events.id] }),
}));

export const rejectionReasonEnum = pgEnum("rejection_reason", [
  "below_cosine",
  "stopword",
  "model_rejected",
  /** Extraction found no quote that exists verbatim in the source. */
  "no_verified_quote",
]);

/**
 * Why a piece of material did not make it into a digest.
 *
 * Kept for fourteen days, then pruned: long enough to build the "closest
 * misses" line of a weekly digest and to answer "why didn't I see X", short
 * enough that a table written on every poll stays small.
 */
export const rejections = pgTable(
  "rejections",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    rawItemId: uuid("raw_item_id").references(() => rawItems.id, { onDelete: "set null" }),
    reason: rejectionReasonEnum("reason").notNull(),
    /** The model's one-line reason, or which stopword matched. Shown to the reader. */
    detail: text("detail"),
    score: numeric("score", { precision: 4, scale: 3 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("rejections_profile_occurred_idx").on(table.profileId, table.occurredAt),
    index("rejections_raw_item_idx").on(table.rawItemId),
  ],
);
