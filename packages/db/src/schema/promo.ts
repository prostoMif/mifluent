/**
 * Discounts beyond the price table: promo codes, dated campaigns, partner
 * codes and "invite a friend".
 *
 * A campaign is a code nobody types: while it runs it applies to everyone.
 * A partner is a code with a partner behind it, who earns a share of what
 * the customers it brought pay. Earnings are paid out by hand from a report;
 * nothing here moves money.
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { paymentOrders } from "./billing.js";
import { id, timestamps } from "./common.js";
import { tenants } from "./tenancy.js";

export const partners = pgTable("partners", {
  id: id(),
  name: text("name").notNull(),
  /** How the owner reaches them to pay out: a Telegram handle, an email. */
  contact: text("contact"),
  /** Share of each payment, in percent. */
  percent: integer("percent").notNull().default(30),
  /** For how many months after a customer's first payment the share is earned. */
  months: integer("months").notNull().default(12),
  ...timestamps,
});

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: id(),
    /** Upper case. What a person types, or what a link carries. */
    code: text("code").notNull(),
    /** community | campaign | winback | selfhost | education | partner */
    kind: text("kind").notNull(),
    /** Off the price, in percent. 0 for a code that only lengthens the trial. */
    percentOff: integer("percent_off").notNull().default(0),
    /** How many paid months the discount covers; null for the whole term. */
    months: integer("months"),
    /** Days of free Pro the code gives instead of money off. */
    trialDays: integer("trial_days"),
    /** Only this plan, when set. */
    planFilter: text("plan_filter"),
    /** Only terms of at least this many months, when set. */
    minMonths: integer("min_months"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    /** Paid orders that used it. Counted on payment, not at checkout. */
    used: integer("used").notNull().default(0),
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
    /** A personal code (win-back): only this tenant may use it. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("promo_codes_code_unique").on(table.code),
    index("promo_codes_kind_idx").on(table.kind, table.startsAt),
    check(
      "promo_codes_kind_check",
      sql`${table.kind} IN ('community', 'campaign', 'winback', 'selfhost', 'education', 'partner')`,
    ),
    check("promo_codes_percent_check", sql`${table.percentOff} BETWEEN 0 AND 100`),
  ],
);

/** One row per friend who came through a tenant's link. */
export const referrals = pgTable(
  "referrals",
  {
    id: id(),
    referrerTenantId: uuid("referrer_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    referredTenantId: uuid("referred_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** signed_up → rewarded once the friend pays */
    status: text("status").notNull().default("signed_up"),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("referrals_referred_unique").on(table.referredTenantId),
    index("referrals_referrer_idx").on(table.referrerTenantId),
    check("referrals_status_check", sql`${table.status} IN ('signed_up', 'rewarded')`),
  ],
);

/** A partner's share of one paid order. Unique per order: a retried notification adds nothing. */
export const partnerEarnings = pgTable(
  "partner_earnings",
  {
    id: id(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => paymentOrders.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    paidOutAt: timestamp("paid_out_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("partner_earnings_order_unique").on(table.orderId),
    index("partner_earnings_partner_idx").on(table.partnerId, table.createdAt),
  ],
);
