/**
 * The instance's daily spending ceiling.
 *
 * A runaway pipeline burning somebody's API credit overnight is the kind of
 * thing that ends a project's reputation in one thread, so the cap is a hard
 * stop, checked before every model call rather than reported afterwards.
 *
 * There is no stored flag. "Has today's spend crossed the cap" is a sum over
 * today's cost rows, and deriving it means there is nothing to reset at
 * midnight and nothing that can get stuck on — a flag and a reset job are two
 * moving parts whose only job is to agree with this query.
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import { desc, gte, sql, sum } from "drizzle-orm";

export interface CostCapState {
  readonly isReached: boolean;
  readonly spentTodayUsd: number;
  readonly capUsd: number;
  /** Midnight UTC that opened the current day, the window the sum covers. */
  readonly dayStartedAt: Date;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Today's spend for the whole instance.
 *
 * Deliberately across every tenant: the cap protects the operator's key, and
 * the operator pays for all of them. This is the one query in the costs module
 * without a tenant predicate, and it only ever returns a number.
 */
export async function readCostCap(
  db: Queryable,
  capUsd: number,
  now: Date = new Date(),
): Promise<CostCapState> {
  const dayStartedAt = startOfUtcDay(now);
  const [row] = await db
    .select({ total: sum(schema.operationCosts.costUsd) })
    .from(schema.operationCosts)
    .where(gte(schema.operationCosts.occurredAt, dayStartedAt));

  const spentTodayUsd = Number(row?.total ?? 0);
  // A cap of zero means "no model calls at all", not "unlimited".
  return { isReached: spentTodayUsd >= capUsd, spentTodayUsd, capUsd, dayStartedAt };
}

export interface SpendByPurpose {
  readonly purpose: string;
  readonly costUsd: number;
  readonly calls: number;
}

export interface SpendSummary {
  readonly todayUsd: number;
  readonly last30DaysUsd: number;
  readonly byPurpose: readonly SpendByPurpose[];
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** What this tenant spent today and over thirty days, split by what it was for. */
export async function summariseSpend(
  db: Queryable,
  tenantId: string,
  now: Date = new Date(),
): Promise<SpendSummary> {
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);
  const purpose = sql<string>`${schema.operationCosts.context}->>'purpose'`;

  const rows = await db
    .select({
      purpose,
      costUsd: sum(schema.operationCosts.costUsd),
      calls: sql<number>`count(*)::int`,
    })
    .from(schema.operationCosts)
    .where(scoped(schema.operationCosts, tenantId, gte(schema.operationCosts.occurredAt, since)))
    .groupBy(purpose)
    .orderBy(desc(sum(schema.operationCosts.costUsd)));

  const [today] = await db
    .select({ total: sum(schema.operationCosts.costUsd) })
    .from(schema.operationCosts)
    .where(
      scoped(
        schema.operationCosts,
        tenantId,
        gte(schema.operationCosts.occurredAt, startOfUtcDay(now)),
      ),
    );

  const byPurpose = rows.map((row) => ({
    purpose: row.purpose ?? "unknown",
    costUsd: Number(row.costUsd ?? 0),
    calls: row.calls,
  }));

  return {
    todayUsd: Number(today?.total ?? 0),
    last30DaysUsd: byPurpose.reduce((total, row) => total + row.costUsd, 0),
    byPurpose,
  };
}
