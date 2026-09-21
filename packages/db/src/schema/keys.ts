/**
 * Model keys supplied by the tenant.
 *
 * The column is `encryptedKey`, never `key`, and nothing in this codebase ever
 * selects it into a response, a log line, an export or an error message. After
 * saving, the only part of a key that is ever displayed again is
 * `lastFourChars`.
 *
 * The encryption key lives in the environment as `ENCRYPTION_KEY`, separate from
 * the session secret so that rotating one does not force rotating the other —
 * and, more importantly, so that a database backup taken without the
 * environment is useless on its own. That separation only holds if the two are
 * not stored in the same backup, which is a documentation problem rather than a
 * schema one, and is written down in docs/security.md.
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aliveOnly, id, softDelete, timestamps } from "./common.js";
import { tenants } from "./tenancy.js";

export const modelTierEnum = pgEnum("model_tier", [
  /** The cheap gate: runs on everything that survives deduplication. */
  "cheap",
  /** Fact and quote extraction: runs only on what the classifier kept. */
  "deep",
]);

export const providerKeys = pgTable(
  "provider_keys",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** "openai", "anthropic", "openrouter", "groq", "google". */
    provider: text("provider").notNull(),
    label: text("label"),
    /** AES-GCM ciphertext, base64. Never selected into any response. */
    encryptedKey: text("encrypted_key").notNull(),
    /** Nonce for the ciphertext above. Unique per key, never reused. */
    encryptionNonce: text("encryption_nonce").notNull(),
    /** Which ENCRYPTION_KEY encrypted this, so rotation can find old rows. */
    encryptionKeyVersion: text("encryption_key_version").notNull().default("v1"),
    /** The only fragment ever shown again. */
    lastFourChars: text("last_four_chars").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    /** Result of the validation call made when the key was entered. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("provider_keys_tenant_idx").on(table.tenantId),
    uniqueIndex("provider_keys_tenant_provider_unique")
      .on(table.tenantId, table.provider)
      .where(aliveOnly),
  ],
);

/** Which model to use for each tier, and the spending ceiling. */
export const modelSettings = pgTable(
  "model_settings",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tier: modelTierEnum("tier").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("model_settings_tenant_tier_unique").on(table.tenantId, table.tier)],
);

/**
 * Daily spend ceiling, enforced by a hard stop rather than a warning.
 *
 * A runaway pipeline burning someone else's API credit overnight is the kind of
 * thing that ends a project's reputation in one Reddit thread.
 */
export const spendLimits = pgTable(
  "spend_limits",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dailyLimitUsd: text("daily_limit_usd").notNull().default("1.00"),
    /** When the cap last stopped work, so the interface can explain a quiet day. */
    lastTrippedAt: timestamp("last_tripped_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("spend_limits_tenant_unique").on(table.tenantId)],
);

export const providerKeysRelations = relations(providerKeys, ({ one }) => ({
  tenant: one(tenants, { fields: [providerKeys.tenantId], references: [tenants.id] }),
}));
