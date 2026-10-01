/**
 * Orders and what a payment does to a tenant.
 *
 * The money facts — plan, term, amount, early price — are fixed in our row
 * when the order is created. A payment notification only says "order X was
 * paid, this much": the amount is checked against our row, never trusted to
 * set the plan or the price.
 *
 * // TODO: security review — payments
 */

import { AppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import { and, count, desc, eq, exists, gt, inArray, isNull, lte, ne } from "drizzle-orm";
import { resolvePlans } from "../plans/plans.js";
import {
  type Currency,
  type PaidPlan,
  type PriceQuote,
  quote,
  type TermMonths,
} from "./pricing.js";

/** A refund on request, no questions asked, within this many days of paying. */
export const REFUND_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreatedOrder {
  readonly orderId: string;
  readonly quote: PriceQuote;
}

/** Paid early Pro seats, by tenant: the counter behind "N early seats left". */
export async function countEarlySeatsTaken(db: Queryable): Promise<number> {
  const [row] = await db
    .select({ seats: count(schema.paymentOrders.tenantId) })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.isEarly, true),
        inArray(schema.paymentOrders.status, ["paid", "refund_requested"]),
      ),
    );
  return row?.seats ?? 0;
}

/**
 * Early price for this tenant: kept for good once paid, otherwise offered
 * while seats remain. A tenant that already holds a seat does not take a
 * second one when it renews.
 */
export async function isEarlyEligible(
  db: Queryable,
  tenantId: string,
  earlySeats: number,
): Promise<boolean> {
  const [held] = await db
    .select({ id: schema.paymentOrders.id })
    .from(schema.paymentOrders)
    .where(
      scoped(
        schema.paymentOrders,
        tenantId,
        eq(schema.paymentOrders.isEarly, true),
        eq(schema.paymentOrders.status, "paid"),
      ),
    )
    .limit(1);
  if (held !== undefined) return true;
  return (await countEarlySeatsTaken(db)) < earlySeats;
}

export async function createOrder(
  db: Queryable,
  input: {
    readonly tenantId: string;
    readonly plan: PaidPlan;
    readonly months: TermMonths;
    readonly currency: Currency;
    readonly earlySeats: number;
  },
): Promise<CreatedOrder> {
  const price = quote({
    plan: input.plan,
    months: input.months,
    currency: input.currency,
    isEarlyEligible: await isEarlyEligible(db, input.tenantId, input.earlySeats),
  });

  const orderId = uuidv7();
  await db.insert(schema.paymentOrders).values({
    id: orderId,
    tenantId: input.tenantId,
    plan: price.plan,
    months: price.months,
    amountMinor: price.amountMinor,
    currency: price.currency,
    isEarly: price.isEarly,
  });
  return { orderId, quote: price };
}

export type NotificationOutcome =
  | "applied"
  | "duplicate"
  | "unknown_order"
  | "amount_mismatch"
  | "not_paid";

export interface PaymentNotification {
  /** The provider's id for this notification, or a hash of its body. */
  readonly eventKey: string;
  /** Our order id, as we passed it to the payment page. */
  readonly orderId: string;
  readonly isPaid: boolean;
  /** What the provider says was paid, in minor units. */
  readonly paidAmountMinor: number;
  readonly payload: Record<string, unknown>;
}

/**
 * Apply one payment notification, at most once.
 *
 * Providers retry a notification until they get an answer, and may send the
 * same one twice; the unique event key and the order's own status both make
 * the second delivery a no-op. A paid order extends the tenant's paid time
 * from wherever it currently ends, so paying early never loses days.
 */
export async function applyPaymentNotification(
  db: Queryable,
  notification: PaymentNotification,
  now: Date = new Date(),
): Promise<NotificationOutcome> {
  return db.transaction(async (transaction) => {
    // Looked up by id alone: a notification arrives with no session and no
    // tenant, only our order id. Every write below is scoped by the tenant
    // the order itself names.
    const [order] = await transaction
      .select()
      .from(schema.paymentOrders)
      .where(eq(schema.paymentOrders.id, notification.orderId))
      .limit(1);

    const recorded = await transaction
      .insert(schema.billingEvents)
      .values({
        id: uuidv7(),
        provider: "prodamus",
        providerEventKey: notification.eventKey,
        orderId: order?.id ?? null,
        payload: notification.payload,
      })
      .onConflictDoNothing()
      .returning({ id: schema.billingEvents.id });

    if (recorded.length === 0) return "duplicate";
    if (order === undefined) return "unknown_order";
    if (order.status !== "created") return "duplicate";

    if (!notification.isPaid) {
      await transaction
        .update(schema.paymentOrders)
        .set({ status: "failed", updatedAt: now })
        .where(scoped(schema.paymentOrders, order.tenantId, eq(schema.paymentOrders.id, order.id)));
      return "not_paid";
    }

    // The provider's figure is checked, never used: a forged or mistaken
    // notification for less money must not buy the plan.
    if (notification.paidAmountMinor !== order.amountMinor) return "amount_mismatch";

    const periodStart = await paidUntil(transaction, order.tenantId, now);
    await transaction
      .update(schema.paymentOrders)
      .set({
        status: "paid",
        paidAt: now,
        periodStart,
        periodEnd: addMonths(periodStart, order.months),
        updatedAt: now,
      })
      .where(scoped(schema.paymentOrders, order.tenantId, eq(schema.paymentOrders.id, order.id)));
    await transaction
      .update(schema.tenants)
      .set({ plan: order.plan, updatedAt: now })
      .where(eq(schema.tenants.id, order.tenantId));
    return "applied";
  });
}

/**
 * Ask for a refund of the latest payment made within the refund window. The
 * money goes back by hand in the provider's dashboard; this records the
 * request and tells the owner.
 */
export async function requestRefund(
  db: Queryable,
  tenantId: string,
  now: Date = new Date(),
): Promise<{ orderId: string; amountMinor: number; currency: string }> {
  const [order] = await db
    .select()
    .from(schema.paymentOrders)
    .where(
      scoped(
        schema.paymentOrders,
        tenantId,
        eq(schema.paymentOrders.status, "paid"),
        gt(schema.paymentOrders.paidAt, new Date(now.getTime() - REFUND_WINDOW_DAYS * DAY_MS)),
      ),
    )
    .orderBy(desc(schema.paymentOrders.paidAt))
    .limit(1);

  if (order === undefined) {
    throw new AppError(
      "refund_window_closed",
      `A refund can be requested within ${REFUND_WINDOW_DAYS} days of paying.`,
    );
  }

  await db
    .update(schema.paymentOrders)
    .set({ status: "refund_requested", updatedAt: now })
    .where(scoped(schema.paymentOrders, tenantId, eq(schema.paymentOrders.id, order.id)));
  return { orderId: order.id, amountMinor: order.amountMinor, currency: order.currency };
}

/**
 * The owner confirms the money went back: the order is refunded and the
 * tenant falls back to whatever other paid time it still has, or to Free.
 * Nothing is deleted; targets past the new plan's limit are paused.
 */
export async function confirmRefund(
  db: Queryable,
  orderId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select({ tenantId: schema.paymentOrders.tenantId, status: schema.paymentOrders.status })
      .from(schema.paymentOrders)
      .where(eq(schema.paymentOrders.id, orderId))
      .limit(1);
    if (order === undefined || order.status !== "refund_requested") {
      throw new AppError("not_found", "Not found.");
    }

    await transaction
      .update(schema.paymentOrders)
      .set({ status: "refunded", periodEnd: now, updatedAt: now })
      .where(scoped(schema.paymentOrders, order.tenantId, eq(schema.paymentOrders.id, orderId)));
    await settleTenantPlan(transaction, order.tenantId, now);
  });
}

/**
 * Daily: tenants whose paid time has run out go back to Free, keeping
 * everything and pausing what Free does not cover. Returns who changed.
 *
 * Only tenants that have ever paid: a plan the owner set by hand — a beta
 * tester, a friend — has no order behind it and is left alone.
 */
export async function expirePaidPlans(db: Queryable, now: Date = new Date()): Promise<string[]> {
  const tenants = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(
      and(
        ne(schema.tenants.plan, "free"),
        isNull(schema.tenants.deletedAt),
        exists(
          db
            .select({ id: schema.paymentOrders.id })
            .from(schema.paymentOrders)
            .where(
              and(
                eq(schema.paymentOrders.tenantId, schema.tenants.id),
                inArray(schema.paymentOrders.status, ["paid", "refunded"]),
              ),
            ),
        ),
      ),
    );

  const downgraded: string[] = [];
  for (const tenant of tenants) {
    const plan = await settleTenantPlan(db, tenant.id, now);
    if (plan === "free") downgraded.push(tenant.id);
  }
  return downgraded;
}

/**
 * Daily: tenants whose free trial ended since yesterday, with targets beyond
 * what Free allows paused (never deleted). Returns who was affected.
 */
export async function closeEndedTrials(db: Queryable, now: Date = new Date()): Promise<string[]> {
  const ended = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(
      and(
        eq(schema.tenants.plan, "free"),
        isNull(schema.tenants.deletedAt),
        lte(schema.tenants.trialEndsAt, now),
        gt(schema.tenants.trialEndsAt, new Date(now.getTime() - DAY_MS)),
      ),
    );

  const freeLimit = resolvePlans().free.maxTargets;
  for (const tenant of ended) {
    await pauseExcessTargets(db, tenant.id, freeLimit, now);
  }
  return ended.map((tenant) => tenant.id);
}

export interface TrialReminder {
  readonly tenantId: string;
  readonly daysLeft: 3 | 1;
}

/**
 * Daily: who to remind that the trial is ending — three days before, and on
 * the last day. Each tenant falls in a one-day window once per reminder.
 */
export async function listTrialReminders(
  db: Queryable,
  now: Date = new Date(),
): Promise<TrialReminder[]> {
  const rows = await db
    .select({ id: schema.tenants.id, trialEndsAt: schema.tenants.trialEndsAt })
    .from(schema.tenants)
    .where(
      and(
        eq(schema.tenants.plan, "free"),
        isNull(schema.tenants.deletedAt),
        gt(schema.tenants.trialEndsAt, now),
        lte(schema.tenants.trialEndsAt, new Date(now.getTime() + 3 * DAY_MS)),
      ),
    );

  return rows.flatMap((row): TrialReminder[] => {
    const left = row.trialEndsAt.getTime() - now.getTime();
    if (left > 2 * DAY_MS) return [{ tenantId: row.id, daysLeft: 3 }];
    if (left <= DAY_MS) return [{ tenantId: row.id, daysLeft: 1 }];
    return [];
  });
}

/** Pause active targets past the limit, newest first; the brand target never counts. */
export async function pauseExcessTargets(
  db: Queryable,
  tenantId: string,
  maxTargets: number,
  now: Date = new Date(),
): Promise<number> {
  const active = await db
    .select({ id: schema.watchTargets.id })
    .from(schema.watchTargets)
    .where(
      scoped(
        schema.watchTargets,
        tenantId,
        isNull(schema.watchTargets.deletedAt),
        isNull(schema.watchTargets.pausedAt),
        ne(schema.watchTargets.kind, "self"),
      ),
    )
    .orderBy(schema.watchTargets.createdAt);

  const excess = active.slice(maxTargets).map((target) => target.id);
  if (excess.length === 0) return 0;

  await db
    .update(schema.watchTargets)
    .set({ pausedAt: now })
    .where(scoped(schema.watchTargets, tenantId, inArray(schema.watchTargets.id, excess)));
  return excess.length;
}

/** Set the tenant's plan from the paid time that covers `now`, or Free. */
async function settleTenantPlan(
  db: Queryable,
  tenantId: string,
  now: Date,
): Promise<PaidPlan | "free"> {
  const [covering] = await db
    .select({ plan: schema.paymentOrders.plan })
    .from(schema.paymentOrders)
    .where(
      scoped(
        schema.paymentOrders,
        tenantId,
        eq(schema.paymentOrders.status, "paid"),
        lte(schema.paymentOrders.periodStart, now),
        gt(schema.paymentOrders.periodEnd, now),
      ),
    )
    .orderBy(desc(schema.paymentOrders.paidAt))
    .limit(1);

  const plan =
    covering?.plan === "starter" || covering?.plan === "pro" || covering?.plan === "team"
      ? covering.plan
      : "free";
  await db
    .update(schema.tenants)
    .set({ plan, updatedAt: now })
    .where(eq(schema.tenants.id, tenantId));

  if (plan === "free") {
    await pauseExcessTargets(db, tenantId, resolvePlans().free.maxTargets, now);
  }
  return plan;
}

/** Where new paid time starts: the end of the paid time already bought, or now. */
async function paidUntil(db: Queryable, tenantId: string, now: Date): Promise<Date> {
  const [latest] = await db
    .select({ periodEnd: schema.paymentOrders.periodEnd })
    .from(schema.paymentOrders)
    .where(
      scoped(
        schema.paymentOrders,
        tenantId,
        eq(schema.paymentOrders.status, "paid"),
        gt(schema.paymentOrders.periodEnd, now),
      ),
    )
    .orderBy(desc(schema.paymentOrders.periodEnd))
    .limit(1);
  return latest?.periodEnd ?? now;
}

/** Calendar months, clamped: Jan 31 + 1 month is Feb 28, not Mar 3. */
export function addMonths(start: Date, months: number): Date {
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export interface BillingStatus {
  readonly paidPlan: string;
  readonly trialEndsAt: Date | null;
  readonly paidUntil: Date | null;
  readonly earlySeatsLeft: number;
  /** The latest payment is still inside the no-questions refund window. */
  readonly isRefundPossible: boolean;
}

/** What the pricing and settings pages show about a tenant's billing. */
export async function getBillingStatus(
  db: Queryable,
  tenantId: string,
  earlySeats: number,
  now: Date = new Date(),
): Promise<BillingStatus> {
  const [tenant] = await db
    .select({ plan: schema.tenants.plan, trialEndsAt: schema.tenants.trialEndsAt })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  const [latest] = await db
    .select({ periodEnd: schema.paymentOrders.periodEnd, paidAt: schema.paymentOrders.paidAt })
    .from(schema.paymentOrders)
    .where(scoped(schema.paymentOrders, tenantId, eq(schema.paymentOrders.status, "paid")))
    .orderBy(desc(schema.paymentOrders.periodEnd))
    .limit(1);
  const refundCutoff = now.getTime() - REFUND_WINDOW_DAYS * DAY_MS;

  return {
    paidPlan: tenant?.plan ?? "free",
    trialEndsAt: tenant?.trialEndsAt ?? null,
    paidUntil: latest?.periodEnd ?? null,
    earlySeatsLeft: Math.max(0, earlySeats - (await countEarlySeatsTaken(db))),
    isRefundPossible: latest?.paidAt != null && latest.paidAt.getTime() > refundCutoff,
  };
}
