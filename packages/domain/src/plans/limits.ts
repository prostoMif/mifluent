/**
 * Enforcing plan limits.
 *
 * Every check lives here, in the domain layer, and is called from the domain
 * functions that create things — never from a route handler, where a second
 * route doing the same thing would forget it.
 *
 * The discovery count is read from the cost log rather than kept in a counter
 * column: every discovery run records its model call with a run identifier, so
 * the log already knows how many happened this month, and a counter would be a
 * second copy of that fact with its own reset job to get wrong.
 */

import { AppError, getConfig } from "@mifluent/core";
import { type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { isPlanName, type PlanLimits, type PlanName, resolvePlans } from "./plans.js";

export interface TenantPlan {
  readonly name: PlanName;
  readonly limits: PlanLimits;
}

export async function findTenantPlan(db: Queryable, tenantId: string): Promise<TenantPlan> {
  const [row] = await db
    .select({ plan: schema.tenants.plan })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)))
    .limit(1);

  // The column has a check constraint, so anything else is a row written by
  // hand; the safe reading of it is the smallest plan.
  const name: PlanName = row !== undefined && isPlanName(row.plan) ? row.plan : "free";
  const plans = resolvePlans(getConfig().planOverrides);
  return { name, limits: plans[name] };
}

export async function setTenantPlan(
  db: Queryable,
  tenantId: string,
  plan: PlanName,
): Promise<void> {
  const updated = await db
    .update(schema.tenants)
    .set({ plan, updatedAt: new Date() })
    .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)))
    .returning({ id: schema.tenants.id });

  if (updated.length === 0) {
    throw new AppError("not_found", "Not found.");
  }
}

export interface ProfileLimitCheck {
  readonly tenantId: string;
  /** The profile being saved, or undefined when creating a new one. */
  readonly profileId: string | undefined;
  readonly targetCount: number;
}

/**
 * Refuse a save that would take the tenant past its plan.
 *
 * Targets are counted across every profile, because the plan's unit is the
 * target: splitting ten competitors over three profiles must not be a way
 * around a limit of three.
 */
export async function assertProfileWithinPlan(
  db: Queryable,
  check: ProfileLimitCheck,
): Promise<void> {
  const { limits } = await findTenantPlan(db, check.tenantId);

  if (check.profileId === undefined) {
    const profiles = await countProfiles(db, check.tenantId);
    if (profiles >= limits.maxProfiles) {
      throw limitReached("profiles", limits.maxProfiles);
    }
  }

  const elsewhere = await countTargetsOutside(db, check.tenantId, check.profileId);
  if (elsewhere + check.targetCount > limits.maxTargets) {
    throw limitReached("watched targets", limits.maxTargets, elsewhere);
  }
}

export interface TargetAllowance {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
}

/** Watched targets in use across all profiles, against the plan. */
export async function readTargetAllowance(
  db: Queryable,
  tenantId: string,
): Promise<TargetAllowance> {
  const { limits } = await findTenantPlan(db, tenantId);
  const used = await countTargetsOutside(db, tenantId, undefined);
  return { used, limit: limits.maxTargets, remaining: Math.max(0, limits.maxTargets - used) };
}

export interface DiscoveryAllowance {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
}

export async function readDiscoveryAllowance(
  db: Queryable,
  tenantId: string,
  now: Date = new Date(),
): Promise<DiscoveryAllowance> {
  const { limits } = await findTenantPlan(db, tenantId);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [row] = await db
    .select({ runs: sql<number>`count(distinct ${schema.operationCosts.context}->>'runId')::int` })
    .from(schema.operationCosts)
    .where(
      scoped(
        schema.operationCosts,
        tenantId,
        eq(schema.operationCosts.step, "discover"),
        gte(schema.operationCosts.occurredAt, monthStart),
      ),
    );

  const used = row?.runs ?? 0;
  return {
    used,
    limit: limits.discoveryPerMonth,
    remaining: Math.max(0, limits.discoveryPerMonth - used),
  };
}

export async function assertCanRunDiscovery(db: Queryable, tenantId: string): Promise<void> {
  const allowance = await readDiscoveryAllowance(db, tenantId);

  if (allowance.remaining === 0) {
    throw new AppError(
      "plan_limit_reached",
      `0 of ${allowance.limit} site readings left this month.`,
      { tenantId, used: allowance.used },
    );
  }
}

function limitReached(what: string, limit: number, used?: number): AppError {
  const left = used === undefined ? 0 : Math.max(0, limit - used);
  return new AppError(
    "plan_limit_reached",
    `Your plan allows ${limit} ${what}; ${left} left. Remove one or change plan.`,
    { limit, used },
  );
}

async function countProfiles(db: Queryable, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.watchProfiles)
    .where(scopedAlive(schema.watchProfiles, tenantId));
  return row?.total ?? 0;
}

async function countTargetsOutside(
  db: Queryable,
  tenantId: string,
  profileId: string | undefined,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.watchTargets)
    .innerJoin(schema.watchProfiles, eq(schema.watchTargets.profileId, schema.watchProfiles.id))
    .where(
      scopedAlive(
        schema.watchTargets,
        tenantId,
        isNull(schema.watchProfiles.deletedAt),
        profileId === undefined ? undefined : ne(schema.watchTargets.profileId, profileId),
      ),
    );
  return row?.total ?? 0;
}
