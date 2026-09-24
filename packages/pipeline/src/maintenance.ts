/**
 * Daily pruning of what the pipeline leaves behind.
 *
 * Both deletes run for the whole instance and are hard deletes: these rows are
 * machine-generated and regenerable, the kind the schema notes say are not
 * soft-deleted.
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import { findTenantPlan } from "@mifluent/domain";
import { isNull, lt } from "drizzle-orm";

/** From TASK-007: long enough for a weekly digest's near misses and "why didn't I see X". */
export const REJECTION_RETENTION_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function pruneRejections(db: Queryable, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REJECTION_RETENTION_DAYS * DAY_MS);
  const removed = await db
    .delete(schema.rejections)
    .where(lt(schema.rejections.occurredAt, cutoff))
    .returning({ id: schema.rejections.id });
  return removed.length;
}

/**
 * Delete fetched material older than the tenant's plan keeps it. Events,
 * facts and digest cards built from it go with it through the foreign keys:
 * a card whose source is gone could no longer show its quote in context.
 */
export async function pruneExpiredMaterial(db: Queryable, now: Date = new Date()): Promise<number> {
  const tenants = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(isNull(schema.tenants.deletedAt));

  let total = 0;
  for (const tenant of tenants) {
    const { limits } = await findTenantPlan(db, tenant.id);
    const cutoff = new Date(now.getTime() - limits.retentionDays * DAY_MS);
    const removed = await db
      .delete(schema.rawItems)
      .where(scoped(schema.rawItems, tenant.id, lt(schema.rawItems.fetchedAt, cutoff)))
      .returning({ id: schema.rawItems.id });
    total += removed.length;
  }
  return total;
}
