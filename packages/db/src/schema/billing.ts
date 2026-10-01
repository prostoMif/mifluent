/**
 * Payments: what a tenant ordered, what the payment provider told us, and the
 * period each payment covers.
 *
 * Prepaid periods, not a recurring charge: a person pays for 1, 3, 6 or 12
 * months and is reminded before the period ends. Nothing renews behind their
 * back, so there is nothing to cancel and no failed renewal to chase.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { tenants } from "./tenancy.js";

export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** starter | pro | team */
    plan: text("plan").notNull(),
    months: integer("months").notNull(),
    /** In kopecks or cents. Fixed when the order is created; the provider's figure is checked against it. */
    amountMinor: integer("amount_minor").notNull(),
    /** RUB | USD */
    currency: text("currency").notNull(),
    /** One of the first paid Pro seats: the early price is kept on every renewal. */
    isEarly: boolean("is_early").notNull().default(false),
    /** created → paid → (refund_requested → refunded); created → failed */
    status: text("status").notNull().default("created"),
    /** "prodamus", or "referral" for a free month earned by inviting a friend. */
    provider: text("provider").notNull().default("prodamus"),
    /** The promo, partner or campaign code that set the price, if any. */
    promoCode: text("promo_code"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("payment_orders_tenant_idx").on(table.tenantId, table.createdAt),
    index("payment_orders_paid_early_idx").on(table.isEarly, table.status),
    check("payment_orders_plan_check", sql`${table.plan} IN ('starter', 'pro', 'team')`),
    check("payment_orders_months_check", sql`${table.months} IN (1, 3, 6, 12)`),
    check("payment_orders_currency_check", sql`${table.currency} IN ('RUB', 'USD')`),
    check(
      "payment_orders_status_check",
      sql`${table.status} IN ('created', 'paid', 'failed', 'refund_requested', 'refunded')`,
    ),
  ],
);

/**
 * Every notification the provider sent, raw. The unique key makes a repeated
 * notification — providers retry until they get a 200 — a no-op.
 */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    /** The provider's id for this notification, or a hash of its body. */
    providerEventKey: text("provider_event_key").notNull(),
    orderId: uuid("order_id").references(() => paymentOrders.id, { onDelete: "set null" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_events_provider_key_unique").on(table.provider, table.providerEventKey),
  ],
);
