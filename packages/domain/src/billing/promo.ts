/**
 * Promo codes and dated campaigns: which discounts a checkout may use.
 *
 * Every price is decided on the server. The browser sends a code, never a
 * percentage; this file checks the code (dates, uses, plan, term, owner) and
 * hands `quote()` the discounts that pass. Promo discounts never stack — the
 * cheapest result wins — and a running campaign competes with them on the
 * same terms.
 *
 * // TODO: security review — payments
 */

import { AppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema } from "@mifluent/db";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Discount, PaidPlan, TermMonths } from "./pricing.js";

type PromoRow = typeof schema.promoCodes.$inferSelect;

const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** Upper case and trimmed; undefined for anything that cannot be a code. */
export function normalizeCode(raw: string | null | undefined): string | undefined {
  const code = raw?.trim().toUpperCase() ?? "";
  return CODE_PATTERN.test(code) ? code : undefined;
}

export interface PromoUse {
  readonly tenantId: string;
  readonly plan: PaidPlan;
  readonly months: TermMonths;
  readonly now: Date;
}

/** Why this code cannot be used for this purchase, in words for the buyer; null when it can. */
export function whyUnusable(row: PromoRow, use: PromoUse): string | null {
  if (row.startsAt !== null && row.startsAt > use.now) return "This code is not active yet.";
  if (row.endsAt !== null && row.endsAt <= use.now) return "This code has expired.";
  if (row.maxUses !== null && row.used >= row.maxUses) return "This code has been used up.";
  if (row.tenantId !== null && row.tenantId !== use.tenantId) return "This code is not valid.";
  if (row.planFilter !== null && row.planFilter !== use.plan) {
    return `This code is for the ${row.planFilter} plan only.`;
  }
  if (row.minMonths !== null && use.months < row.minMonths) {
    return `This code works on a ${row.minMonths}-month term or longer.`;
  }
  if (row.percentOff === 0) return "This code adds free days rather than money off.";
  return null;
}

export function toDiscount(row: PromoRow): Discount {
  return {
    code: row.code,
    kind: row.kind === "campaign" ? "campaign" : "code",
    percentOff: row.percentOff,
    months: row.months,
  };
}

export async function findPromo(db: Queryable, code: string): Promise<PromoRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.promoCodes)
    .where(eq(schema.promoCodes.code, code))
    .limit(1);
  return row;
}

/** Campaigns running now, best first. They apply without anyone typing them. */
export async function activeCampaigns(db: Queryable, now: Date): Promise<PromoRow[]> {
  const rows = await db
    .select()
    .from(schema.promoCodes)
    .where(
      and(
        eq(schema.promoCodes.kind, "campaign"),
        or(isNull(schema.promoCodes.startsAt), lte(schema.promoCodes.startsAt, now)),
        or(isNull(schema.promoCodes.endsAt), gt(schema.promoCodes.endsAt, now)),
      ),
    );
  return rows.sort((left, right) => right.percentOff - left.percentOff);
}

/**
 * The discounts a checkout may try: a code typed now (an unusable one is an
 * error the buyer sees), the code remembered from sign-up (silently skipped
 * when no longer usable), and every running campaign.
 */
export async function usableDiscounts(
  db: Queryable,
  use: PromoUse & { readonly typedCode?: string | undefined },
): Promise<Discount[]> {
  const discounts: Discount[] = [];
  if (use.typedCode !== undefined) discounts.push(await typedDiscount(db, use.typedCode, use));

  const remembered = await rememberedPromo(db, use.tenantId);
  if (remembered !== undefined && whyUnusable(remembered, use) === null) {
    discounts.push(toDiscount(remembered));
  }

  for (const row of await activeCampaigns(db, use.now)) {
    if (whyUnusable(row, use) === null) discounts.push(toDiscount(row));
  }
  return discounts;
}

async function typedDiscount(db: Queryable, typed: string, use: PromoUse): Promise<Discount> {
  const code = normalizeCode(typed);
  const row = code === undefined ? undefined : await findPromo(db, code);
  const reason = row === undefined ? "This code is not valid." : whyUnusable(row, use);
  if (row === undefined || reason !== null) {
    throw new AppError("promo_code_invalid", reason ?? "This code is not valid.");
  }
  return toDiscount(row);
}

async function rememberedPromo(db: Queryable, tenantId: string): Promise<PromoRow | undefined> {
  const [tenant] = await db
    .select({ acquiredCode: schema.tenants.acquiredCode })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  return tenant?.acquiredCode == null ? undefined : findPromo(db, tenant.acquiredCode);
}

/** One more paid order used this code. Called inside the payment transaction. */
export async function countPromoUse(db: Queryable, code: string): Promise<void> {
  await db
    .update(schema.promoCodes)
    .set({ used: sql`${schema.promoCodes.used} + 1` })
    .where(eq(schema.promoCodes.code, code));
}

/**
 * A code that gives free Pro days instead of money off (SELFHOST): the trial
 * is lengthened to that many days from now, once per tenant and only before
 * its first payment.
 */
export async function redeemTrialCode(
  db: Queryable,
  tenantId: string,
  rawCode: string,
  now: Date = new Date(),
): Promise<Date> {
  const code = normalizeCode(rawCode);
  const row = code === undefined ? undefined : await findPromo(db, code);
  if (row === undefined || row.trialDays === null) {
    throw new AppError("promo_code_invalid", "This code is not valid.");
  }
  if (row.endsAt !== null && row.endsAt <= now) {
    throw new AppError("promo_code_invalid", "This code has expired.");
  }

  const [tenant] = await db
    .select({ acquiredCode: schema.tenants.acquiredCode, trialEndsAt: schema.tenants.trialEndsAt })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  const [paid] = await db
    .select({ id: schema.paymentOrders.id })
    .from(schema.paymentOrders)
    .where(
      and(eq(schema.paymentOrders.tenantId, tenantId), eq(schema.paymentOrders.status, "paid")),
    )
    .limit(1);
  if (tenant === undefined || paid !== undefined || tenant.acquiredCode === row.code) {
    throw new AppError("promo_code_invalid", "This code has already been used on this account.");
  }

  const extended = new Date(now.getTime() + row.trialDays * 24 * 60 * 60 * 1000);
  const trialEndsAt = extended > tenant.trialEndsAt ? extended : tenant.trialEndsAt;
  await db
    .update(schema.tenants)
    .set({ trialEndsAt, acquiredVia: "code", acquiredCode: row.code, updatedAt: now })
    .where(eq(schema.tenants.id, tenantId));
  return trialEndsAt;
}

const WINBACK_PERCENT = 40;
const WINBACK_MONTHS = 2;
const WINBACK_VALID_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tenants whose paid time ran out 30 to 60 days ago and who have not paid
 * since, and were never sent a win-back. The 60-day edge keeps a first run
 * from writing to everyone who ever left.
 */
export async function listWinbackCandidates(db: Queryable, now: Date): Promise<string[]> {
  const rows = await db
    .select({ tenantId: schema.paymentOrders.tenantId })
    .from(schema.paymentOrders)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.paymentOrders.tenantId))
    .where(
      and(
        eq(schema.tenants.plan, "free"),
        isNull(schema.tenants.winbackSentAt),
        isNull(schema.tenants.deletedAt),
        eq(schema.paymentOrders.status, "paid"),
        eq(schema.paymentOrders.provider, "prodamus"),
      ),
    )
    .groupBy(schema.paymentOrders.tenantId)
    .having(
      and(
        lte(sql`max(${schema.paymentOrders.periodEnd})`, new Date(now.getTime() - 30 * DAY_MS)),
        gt(sql`max(${schema.paymentOrders.periodEnd})`, new Date(now.getTime() - 60 * DAY_MS)),
      ),
    );
  return rows.map((row) => row.tenantId);
}

/** A personal −40%-for-two-months code, valid a week. Marks the tenant so it never gets a second. */
export async function issueWinbackCode(
  db: Queryable,
  tenantId: string,
  now: Date,
): Promise<{ code: string; endsAt: Date } | undefined> {
  return db.transaction(async (transaction) => {
    const marked = await transaction
      .update(schema.tenants)
      .set({ winbackSentAt: now, updatedAt: now })
      .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.winbackSentAt)))
      .returning({ id: schema.tenants.id });
    if (marked.length === 0) return undefined;

    const code = `BACK-${randomCode(6)}`;
    const endsAt = new Date(now.getTime() + WINBACK_VALID_DAYS * DAY_MS);
    await transaction.insert(schema.promoCodes).values({
      id: uuidv7(),
      code,
      kind: "winback",
      percentOff: WINBACK_PERCENT,
      months: WINBACK_MONTHS,
      endsAt,
      maxUses: 1,
      tenantId,
    });
    return { code, endsAt };
  });
}

/** No 0/O or 1/I: these are read off a phone screen and typed by hand. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
