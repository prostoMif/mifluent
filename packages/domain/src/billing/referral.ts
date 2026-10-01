/**
 * "Invite a friend" and where each new customer came from.
 *
 * A friend who signs up through a tenant's link gets a 28-day trial instead
 * of 14. When the friend first pays, the inviter gets a month: added after
 * the paid time it already has, or a month of Starter if it is on Free. At
 * most twelve such months per inviter, and never for inviting oneself.
 *
 * The free month is an order like any other — provider "referral", amount
 * zero — so the paid-time arithmetic in orders.ts covers it without a second
 * set of rules.
 *
 * // TODO: security review — payments
 */

import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema } from "@mifluent/db";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { addMonths } from "./dates.js";
import { normalizeCode, randomCode } from "./promo.js";

export const REFERRAL_TRIAL_DAYS = 28;
export const MAX_REFERRAL_MONTHS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The tenant's own invite code, made the first time it is asked for. */
export async function getReferralCode(db: Queryable, tenantId: string): Promise<string> {
  const [tenant] = await db
    .select({ code: schema.tenants.referralCode })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  if (tenant?.code != null) return tenant.code;

  // Eight characters from 32: a clash is a one-in-a-trillion event, and the
  // unique index turns one into a retry rather than a shared code.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = randomCode(8);
    try {
      await db
        .update(schema.tenants)
        .set({ referralCode: code })
        .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.referralCode)));
      const [stored] = await db
        .select({ code: schema.tenants.referralCode })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);
      if (stored?.code != null) return stored.code;
    } catch {
      // Unique violation: try another.
    }
  }
  throw new Error("Could not make a referral code.");
}

export interface ReferralStats {
  readonly code: string;
  readonly signedUp: number;
  readonly rewarded: number;
}

export async function getReferralStats(db: Queryable, tenantId: string): Promise<ReferralStats> {
  const code = await getReferralCode(db, tenantId);
  const rows = await db
    .select({ status: schema.referrals.status, total: count() })
    .from(schema.referrals)
    .where(eq(schema.referrals.referrerTenantId, tenantId))
    .groupBy(schema.referrals.status);
  const rewarded = rows.find((row) => row.status === "rewarded")?.total ?? 0;
  const signedUp = rows.reduce((sum, row) => sum + row.total, 0);
  return { code, signedUp, rewarded };
}

export interface Acquisition {
  readonly tenantId: string;
  /** The new account's email, to refuse a person inviting themselves. */
  readonly email: string | null;
  readonly referralCode?: string | null | undefined;
  readonly promoCode?: string | null | undefined;
}

/**
 * Record, once, how a brand-new tenant arrived: a friend's link wins over a
 * promo code, and a tenant that already has a source keeps it. A promo code
 * is remembered rather than checked here: it is checked at checkout, when
 * the plan and term are known.
 */
export async function recordAcquisition(
  db: Queryable,
  input: Acquisition,
  now: Date = new Date(),
): Promise<"referral" | "code" | "organic"> {
  const [tenant] = await db
    .select({ acquiredVia: schema.tenants.acquiredVia, createdAt: schema.tenants.createdAt })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, input.tenantId))
    .limit(1);
  // Only for a tenant made in the last day: an old account cannot pick up a
  // friend's reward by following a link later.
  if (
    tenant === undefined ||
    tenant.acquiredVia !== "organic" ||
    now.getTime() - tenant.createdAt.getTime() > DAY_MS
  ) {
    return "organic";
  }

  const referrer = await findReferrer(db, input.referralCode);
  if (referrer !== undefined && !(await isSamePerson(db, referrer, input))) {
    await db.insert(schema.referrals).values({
      id: uuidv7(),
      referrerTenantId: referrer,
      referredTenantId: input.tenantId,
    });
    await db
      .update(schema.tenants)
      .set({
        acquiredVia: "referral",
        trialEndsAt: new Date(tenant.createdAt.getTime() + REFERRAL_TRIAL_DAYS * DAY_MS),
        updatedAt: now,
      })
      .where(eq(schema.tenants.id, input.tenantId));
    return "referral";
  }

  const promo = normalizeCode(input.promoCode);
  if (promo !== undefined) {
    await db
      .update(schema.tenants)
      .set({ acquiredVia: "code", acquiredCode: promo, updatedAt: now })
      .where(eq(schema.tenants.id, input.tenantId));
    return "code";
  }
  return "organic";
}

async function findReferrer(
  db: Queryable,
  rawCode: string | null | undefined,
): Promise<string | undefined> {
  const code = normalizeCode(rawCode);
  if (code === undefined) return undefined;
  const [row] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.referralCode, code), isNull(schema.tenants.deletedAt)))
    .limit(1);
  return row?.id;
}

/** The same tenant, or an account of the inviting tenant with the same email. */
async function isSamePerson(db: Queryable, referrerTenantId: string, input: Acquisition) {
  if (referrerTenantId === input.tenantId) return true;
  if (input.email === null) return false;
  const [match] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.user.id))
    .where(
      and(
        eq(schema.memberships.tenantId, referrerTenantId),
        sql`lower(${schema.user.email}) = ${input.email.trim().toLowerCase()}`,
      ),
    )
    .limit(1);
  return match !== undefined;
}

/**
 * The friend has paid: give the inviter its month. Inside the payment
 * transaction; a second payment by the same friend finds the referral
 * already rewarded and does nothing.
 */
export async function rewardReferrer(
  db: Queryable,
  referredTenantId: string,
  now: Date,
): Promise<string | undefined> {
  const [referral] = await db
    .update(schema.referrals)
    .set({ status: "rewarded", rewardedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.referrals.referredTenantId, referredTenantId),
        eq(schema.referrals.status, "signed_up"),
      ),
    )
    .returning({ referrerTenantId: schema.referrals.referrerTenantId });
  if (referral === undefined) return undefined;
  const referrerId = referral.referrerTenantId;

  const [given] = await db
    .select({ total: count() })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.tenantId, referrerId),
        eq(schema.paymentOrders.provider, "referral"),
      ),
    );
  if ((given?.total ?? 0) >= MAX_REFERRAL_MONTHS) return undefined;

  const [tenant] = await db
    .select({ plan: schema.tenants.plan, trialEndsAt: schema.tenants.trialEndsAt })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, referrerId))
    .limit(1);
  if (tenant === undefined) return undefined;

  const [latest] = await db
    .select({ periodEnd: schema.paymentOrders.periodEnd, plan: schema.paymentOrders.plan })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.tenantId, referrerId),
        eq(schema.paymentOrders.status, "paid"),
        gt(schema.paymentOrders.periodEnd, now),
      ),
    )
    .orderBy(desc(schema.paymentOrders.periodEnd))
    .limit(1);

  // After the paid time it has; on Free, after the trial, so the trial's Pro
  // is not swapped for a month of Starter.
  const trialEnd = tenant.trialEndsAt > now ? tenant.trialEndsAt : now;
  const periodStart = latest?.periodEnd ?? trialEnd;
  const plan = latest?.plan ?? (tenant.plan === "free" ? "starter" : tenant.plan);

  await db.insert(schema.paymentOrders).values({
    id: uuidv7(),
    tenantId: referrerId,
    plan,
    months: 1,
    amountMinor: 0,
    currency: "RUB",
    status: "paid",
    provider: "referral",
    paidAt: now,
    periodStart,
    periodEnd: addMonths(periodStart, 1),
  });
  if (tenant.plan === "free" && periodStart <= now) {
    await db
      .update(schema.tenants)
      .set({ plan, updatedAt: now })
      .where(eq(schema.tenants.id, referrerId));
  }
  return referrerId;
}
