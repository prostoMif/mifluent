/**
 * Partners: someone with an audience gets a code. Their followers pay 20%
 * less for three months, and the partner earns 30% of every payment those
 * customers make for twelve months after their first one.
 *
 * Earnings are recorded here and paid out by hand from `partners:report`;
 * nothing in this file moves money.
 *
 * // TODO: security review — payments
 */

import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema } from "@mifluent/db";
import { and, asc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { addMonths } from "./dates.js";
import { normalizeCode } from "./promo.js";

export const PARTNER_CUSTOMER_PERCENT = 20;
export const PARTNER_CUSTOMER_MONTHS = 3;

/** A new partner and their code. For the owner's CLI. */
export async function addPartner(
  db: Queryable,
  input: { readonly name: string; readonly code: string; readonly contact: string | null },
): Promise<{ partnerId: string; code: string }> {
  const code = normalizeCode(input.code);
  if (code === undefined) throw new Error("A code is 3–32 letters, digits, - or _.");
  const partnerId = uuidv7();
  await db.transaction(async (transaction) => {
    await transaction
      .insert(schema.partners)
      .values({ id: partnerId, name: input.name, contact: input.contact });
    await transaction.insert(schema.promoCodes).values({
      id: uuidv7(),
      code,
      kind: "partner",
      percentOff: PARTNER_CUSTOMER_PERCENT,
      months: PARTNER_CUSTOMER_MONTHS,
      partnerId,
    });
  });
  return { partnerId, code };
}

interface PaidOrder {
  readonly id: string;
  readonly tenantId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/**
 * The partner's share of one paid order, if the customer came through a
 * partner code and is still inside the partner's months. Inside the payment
 * transaction; unique per order.
 */
export async function recordPartnerEarning(
  db: Queryable,
  order: PaidOrder,
  now: Date,
): Promise<number> {
  const [link] = await db
    .select({
      partnerId: schema.partners.id,
      percent: schema.partners.percent,
      months: schema.partners.months,
    })
    .from(schema.tenants)
    .innerJoin(schema.promoCodes, eq(schema.promoCodes.code, schema.tenants.acquiredCode))
    .innerJoin(schema.partners, eq(schema.partners.id, schema.promoCodes.partnerId))
    .where(eq(schema.tenants.id, order.tenantId))
    .limit(1);
  if (link === undefined || order.amountMinor === 0) return 0;

  const [first] = await db
    .select({ paidAt: schema.paymentOrders.paidAt })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.tenantId, order.tenantId),
        eq(schema.paymentOrders.status, "paid"),
        ne(schema.paymentOrders.provider, "referral"),
      ),
    )
    .orderBy(asc(schema.paymentOrders.paidAt))
    .limit(1);
  const firstPaidAt = first?.paidAt ?? now;
  if (now >= addMonths(firstPaidAt, link.months)) return 0;

  const amountMinor = Math.round((order.amountMinor * link.percent) / 100);
  const inserted = await db
    .insert(schema.partnerEarnings)
    .values({
      id: uuidv7(),
      partnerId: link.partnerId,
      tenantId: order.tenantId,
      orderId: order.id,
      amountMinor,
      currency: order.currency,
      // Earned when the payment landed: the monthly report goes by this.
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: schema.partnerEarnings.id });
  return inserted.length > 0 ? amountMinor : 0;
}

export interface PartnerReportRow {
  readonly partnerId: string;
  readonly name: string;
  readonly contact: string | null;
  readonly currency: string;
  readonly payments: number;
  readonly earnedMinor: number;
  readonly unpaidMinor: number;
}

/** What each partner earned in [from, to), and how much of all their earnings is still unpaid. */
export async function partnersReport(
  db: Queryable,
  from: Date,
  to: Date,
): Promise<PartnerReportRow[]> {
  const inPeriod = and(
    gte(schema.partnerEarnings.createdAt, from),
    lt(schema.partnerEarnings.createdAt, to),
  );
  const rows = await db
    .select({
      partnerId: schema.partners.id,
      name: schema.partners.name,
      contact: schema.partners.contact,
      currency: schema.partnerEarnings.currency,
      payments: sql<number>`count(*) filter (where ${inPeriod})`.mapWith(Number),
      earnedMinor:
        sql<number>`coalesce(sum(${schema.partnerEarnings.amountMinor}) filter (where ${inPeriod}), 0)`.mapWith(
          Number,
        ),
      unpaidMinor:
        sql<number>`coalesce(sum(${schema.partnerEarnings.amountMinor}) filter (where ${schema.partnerEarnings.paidOutAt} is null), 0)`.mapWith(
          Number,
        ),
    })
    .from(schema.partnerEarnings)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.partnerEarnings.partnerId))
    .groupBy(
      schema.partners.id,
      schema.partners.name,
      schema.partners.contact,
      schema.partnerEarnings.currency,
    )
    .orderBy(schema.partners.name);
  return rows;
}
