/**
 * Column helpers shared by every table.
 *
 * The conventions they encode, decided before any of this was written:
 *
 * - `tenant_id` is on every tenant-owned table, and no query runs without it.
 * - Identifiers are UUIDv7 generated in the application, never a column default,
 *   so an object has an identity before the insert and can be named in a log
 *   line if the insert fails.
 * - Every timestamp is `timestamptz` and every value is UTC. There is no local
 *   time inside this system; conversion happens when something is rendered.
 * - Soft deletion applies only to things a person created by hand and might
 *   remove by accident. Machine-generated rows are deleted for real — they
 *   regenerate, and a flag on a table of millions of rows is just a slower scan.
 */

import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** Primary key. No default: the application supplies a UUIDv7. */
export const id = () => uuid("id").primaryKey();

/** Tenant ownership. Present on every tenant-scoped table. */
export const tenantId = () => uuid("tenant_id").notNull();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Null means alive. Only on tables a person edits by hand. */
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
};

export const softDelete = {
  deletedAt: deletedAt(),
};

/**
 * Predicate for partial unique indexes on soft-deletable tables.
 *
 * Without it, a deleted row keeps its name or email reserved forever and the
 * user cannot re-create what they just removed.
 */
export const aliveOnly = sql`deleted_at IS NULL`;
