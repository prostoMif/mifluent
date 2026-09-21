import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Closed sets live in the database as enums so that a typo cannot reach a row.
 *
 * Adding a value to a Postgres enum is cheap; removing one is not. When in
 * doubt, leave the value and stop writing it.
 */

export const memberRole = pgEnum("member_role", ["owner", "member"]);

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const sourceKind = pgEnum("source_kind", [
  "rss",
  "reddit",
  "hacker_news",
  "google_news",
  "email_inbox",
  "page_diff",
]);

export const sourceStatus = pgEnum("source_status", [
  "active",
  "paused",
  // Repeated failures. Stays in the list so the user can see it is broken
  // rather than silently receiving less.
  "broken",
]);

/**
 * The three things worth watching. Competitors are only one of them — the
 * distinction exists because "platform changed its rules" and "the tax rules in
 * your market changed" are different kinds of event with different sources.
 */
export const watchKind = pgEnum("watch_kind", ["competitor", "platform", "market"]);

/**
 * A digest card is assembled from separately attributed blocks. Never merge two
 * kinds into one paragraph — the whole point is that the reader can see which
 * sentence is a fact and which is a machine's opinion.
 */
export const cardBlockKind = pgEnum("card_block_kind", [
  "fact",
  "relevance",
  "analyst_opinion",
  "model_interpretation",
]);

export const digestStatus = pgEnum("digest_status", ["pending", "ready", "delivered", "failed"]);

export const deliveryChannel = pgEnum("delivery_channel", ["telegram", "email"]);

/**
 * What a user did with a card. This is the training signal for the classifier,
 * which is why it is logged from the first commit — it cannot be reconstructed
 * afterwards.
 */
export const userAction = pgEnum("user_action", [
  "saved",
  "discarded",
  "copied",
  "opened_source",
  "not_relevant",
]);

/** Which stage of the cascade spent money or time. */
export const pipelineStage = pgEnum("pipeline_stage", [
  "fetch",
  "embed",
  "classify",
  "extract",
  "verify",
  "match",
  "compose",
]);
