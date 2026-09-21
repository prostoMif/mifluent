/**
 * Tenant scoping.
 *
 * The rule this file exists to serve: no query touching tenant-owned data runs
 * without a `tenant_id` predicate, and no object is ever returned by identifier
 * alone without an ownership check. Reading someone else's data is the worst bug
 * this product can have, and it is also the easiest one to write by accident —
 * it looks exactly like a correct query with one missing line.
 *
 * How this is enforced, honestly stated:
 *
 * 1. The raw connection is exported as `unsafeDb`. The name is the point: it
 *    should be uncomfortable to type and obvious in a diff.
 * 2. `tenantDb()` returns builders with the predicate already applied. Ordinary
 *    code uses these and cannot forget.
 * 3. `requireOwnership()` covers the case where a row has already been fetched.
 *
 * What this is not: a compiler-level guarantee. A determined author can still
 * import `unsafeDb` and write whatever they like. The tests in
 * `tenant.test.ts` and the pull request checklist are the backstop, and the
 * pull request template asks about it directly.
 */

import { AppError } from "@mifluent/core";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

/** A table that belongs to a tenant. Every one of them has these two columns. */
export interface TenantScopedTable extends PgTable {
  readonly id: PgColumn;
  readonly tenantId: PgColumn;
}

/** A table that supports soft deletion. */
export interface SoftDeletableTable extends TenantScopedTable {
  readonly deletedAt: PgColumn;
}

/**
 * The tenant predicate on its own.
 *
 * Use when composing a query by hand that the helpers below do not cover — and
 * prefer the helpers.
 */
export function belongsTo(table: TenantScopedTable, tenantId: string): SQL {
  const predicate = eq(table.tenantId, tenantId);
  if (predicate === undefined) {
    // Cannot happen with a real column, but an undefined predicate silently
    // widens a query to every tenant, so it is worth being loud about.
    throw new AppError("internal_error", "Something went wrong on our side.", {
      reason: "tenant predicate could not be built",
    });
  }
  return predicate;
}

/** The tenant predicate, plus whatever else the caller needs. */
export function scoped(
  table: TenantScopedTable,
  tenantId: string,
  ...rest: (SQL | undefined)[]
): SQL {
  const combined = and(belongsTo(table, tenantId), ...rest);
  return combined ?? belongsTo(table, tenantId);
}

/** The tenant predicate, excluding soft-deleted rows. */
export function scopedAlive(
  table: SoftDeletableTable,
  tenantId: string,
  ...rest: (SQL | undefined)[]
): SQL {
  return scoped(table, tenantId, isNull(table.deletedAt), ...rest);
}

/** The tenant predicate, narrowed to one row. */
export function scopedById(table: TenantScopedTable, tenantId: string, rowId: string): SQL {
  return scoped(table, tenantId, eq(table.id, rowId));
}

/**
 * Check a row that has already been loaded.
 *
 * Returns "not found" rather than "forbidden" on a mismatch, on purpose: telling
 * someone that a record exists but is not theirs confirms it exists, which is a
 * small information leak and an easy one to avoid.
 */
export function requireOwnership<T extends { tenantId: string }>(
  row: T | undefined,
  tenantId: string,
): T {
  if (row === undefined || row.tenantId !== tenantId) {
    throw new AppError("not_found", "Not found.");
  }
  return row;
}

/**
 * Values to insert, with the tenant filled in.
 *
 * Takes the tenant separately from the values so that a caller cannot pass one
 * through from a request body — which is the other half of this bug class, and
 * the half that lets someone write into a tenant that is not theirs.
 */
export function withTenant<T extends Record<string, unknown>>(
  tenantId: string,
  values: T,
): T & { tenantId: string } {
  if ("tenantId" in values && values["tenantId"] !== tenantId) {
    throw new AppError("forbidden", "You do not have access to that.", {
      reason: "tenant id in payload did not match the session",
    });
  }
  return { ...values, tenantId };
}
