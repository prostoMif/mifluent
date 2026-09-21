/**
 * The watch profile: what a tenant asked to be watched, and every version of
 * that answer.
 *
 * Versioning is the part worth explaining. Every event and every digest records
 * the profile version it was produced under. Without that, the question "why did
 * this show up in my digest on Tuesday" is unanswerable, because the profile has
 * since changed and the selection logic can no longer be reproduced. Debugging
 * relevance without it is guesswork.
 *
 * A new version is created only by a change that affects selection — topics,
 * competitors, stopwords, the set of sources, the strictness threshold.
 * Changing delivery time, channel, timezone or the profile's name does not, or
 * the rebuild counter would be inflated by settings that have nothing to do with
 * what gets selected.
 */

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aliveOnly, id, softDelete, timestamps } from "./common.js";
import { tenants } from "./tenancy.js";

/** What kind of thing is being watched. Drives how it is described and matched. */
export const watchTargetKindEnum = pgEnum("watch_target_kind", [
  /** Someone selling to the same people. */
  "competitor",
  /** A platform or supplier the business depends on: Stripe, Shopify, a marketplace. */
  "platform",
  /** External conditions: taxes, tariffs, regulation, rates. */
  "condition",
]);

export const watchProfiles = pgTable(
  "watch_profiles",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What the business does, as understood at onboarding. Feeds relevance. */
    businessDescription: text("business_description"),
    /** The site the description was derived from, if any. */
    websiteUrl: text("website_url"),
    /**
     * Structural facts about the business: monetization, platforms, countries,
     * customerType, whatMatters, language. Changing facts creates a new profile
     * version because it affects source/target selection.
     */
    facts: jsonb("facts")
      .$type<{
        monetization?: "free" | "trial" | "subscription" | "one_time" | "unknown";
        platforms?: string[];
        countries?: string[];
        customerType?: string;
        whatMatters?: string;
        language?: "en" | "ru";
      }>()
      .notNull()
      .default({}),
    /**
     * Selection strictness, 0..1. Deliberately a stored setting rather than a
     * constant: the right threshold differs by niche, and hard-coding it means
     * arguing about it in issues instead of changing it.
     */
    relevanceThreshold: real("relevance_threshold").notNull().default(0.5),
    /** Points at the version currently in force. */
    currentVersionId: uuid("current_version_id"),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("watch_profiles_tenant_idx").on(table.tenantId),
    uniqueIndex("watch_profiles_tenant_name_unique")
      .on(table.tenantId, table.name)
      .where(aliveOnly),
  ],
);

export const watchProfileVersions = pgTable(
  "watch_profile_versions",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    /** Monotonic per profile, starting at 1. */
    version: integer("version").notNull(),
    /**
     * Everything that affected selection at this version — topics, targets,
     * stopwords, source ids, threshold — frozen as JSON. Denormalised on
     * purpose: the live tables change, and this has to stay readable years
     * later.
     */
    snapshot: jsonb("snapshot").notNull(),
    /** Free text: what changed and why. Shown in the profile history. */
    changeReason: text("change_reason"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("watch_profile_versions_profile_version_unique").on(table.profileId, table.version),
    index("watch_profile_versions_tenant_idx").on(table.tenantId),
  ],
);

export const topics = pgTable(
  "topics",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** Longer phrasing used for embedding. A bare label matches poorly. */
    description: text("description"),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("topics_profile_idx").on(table.profileId),
    uniqueIndex("topics_profile_label_unique").on(table.profileId, table.label).where(aliveOnly),
  ],
);

/**
 * A company or platform being watched. Named `watch_targets` rather than
 * `competitors` because two of the three kinds are not competitors, and a table
 * called `competitors` holding Stripe would mislead everyone who reads it later.
 */
export const watchTargets = pgTable(
  "watch_targets",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    kind: watchTargetKindEnum("kind").notNull(),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    /** Other names the same thing goes by, for matching. */
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    /** Why this matters to the business. Written by the model, editable. */
    reason: text("reason"),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("watch_targets_profile_idx").on(table.profileId),
    index("watch_targets_kind_idx").on(table.kind),
    uniqueIndex("watch_targets_profile_name_unique")
      .on(table.profileId, table.name)
      .where(aliveOnly),
  ],
);

export const stopwords = pgTable(
  "stopwords",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => watchProfiles.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex("stopwords_profile_term_unique").on(table.profileId, table.term).where(aliveOnly),
  ],
);

export const watchProfilesRelations = relations(watchProfiles, ({ many, one }) => ({
  tenant: one(tenants, { fields: [watchProfiles.tenantId], references: [tenants.id] }),
  versions: many(watchProfileVersions),
  topics: many(topics),
  targets: many(watchTargets),
  stopwords: many(stopwords),
}));

export const watchProfileVersionsRelations = relations(watchProfileVersions, ({ one }) => ({
  profile: one(watchProfiles, {
    fields: [watchProfileVersions.profileId],
    references: [watchProfiles.id],
  }),
}));
