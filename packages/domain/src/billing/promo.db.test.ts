import { uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPartner, partnersReport } from "./affiliate.js";
import { applyPaymentNotification, createOrder, expirePaidPlans } from "./orders.js";
import { issueWinbackCode, listWinbackCandidates, redeemTrialCode } from "./promo.js";
import { getReferralCode, getReferralStats, recordAcquisition } from "./referral.js";

const DATABASE_TIMEOUT = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Outside every seeded campaign.
const NOW = new Date("2026-10-05T10:00:00Z");

async function createTenant(db: Database, email = `${uuidv7()}@example.com`) {
  const tenantId = uuidv7();
  const userId = uuidv7();
  await db.insert(schema.tenants).values({ id: tenantId, name: "Shop", createdAt: NOW });
  await db.insert(schema.user).values({ id: userId, name: "Owner", email });
  await db.insert(schema.memberships).values({ id: uuidv7(), tenantId, userId, role: "owner" });
  return { tenantId, email };
}

async function pay(
  db: Database,
  tenantId: string,
  options: { months?: 1 | 3 | 6 | 12; at?: Date; promoCode?: string } = {},
) {
  const at = options.at ?? NOW;
  const order = await createOrder(db, {
    tenantId,
    plan: "starter",
    months: options.months ?? 1,
    currency: "RUB",
    earlySeats: 0,
    promoCode: options.promoCode,
    now: at,
  });
  const notification = {
    eventKey: `event-${order.orderId}`,
    orderId: order.orderId,
    isPaid: true,
    paidAmountMinor: order.quote.amountMinor,
    payload: {},
  };
  await applyPaymentNotification(db, notification, at);
  return { order, notification };
}

async function tenantRow(db: Database, tenantId: string) {
  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return row;
}

describe("promo codes, referrals and partners against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "refuses an expired, used-up or wrong-plan code with the reason",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      await db.insert(schema.promoCodes).values([
        { id: uuidv7(), code: "OLD", kind: "community", percentOff: 20, endsAt: NOW },
        { id: uuidv7(), code: "GONE", kind: "community", percentOff: 20, maxUses: 1, used: 1 },
        { id: uuidv7(), code: "TEAMONLY", kind: "community", percentOff: 20, planFilter: "team" },
      ]);
      const order = (promoCode: string) =>
        createOrder(db, {
          tenantId,
          plan: "starter",
          months: 1,
          currency: "RUB",
          earlySeats: 0,
          promoCode,
          now: NOW,
        });

      await expect(order("old")).rejects.toMatchObject({
        code: "promo_code_invalid",
        message: "This code has expired.",
      });
      await expect(order("GONE")).rejects.toMatchObject({ message: "This code has been used up." });
      await expect(order("TEAMONLY")).rejects.toMatchObject({
        message: "This code is for the team plan only.",
      });
      await expect(order("NOSUCH")).rejects.toMatchObject({ code: "promo_code_invalid" });
      const plain = await createOrder(db, {
        tenantId,
        plan: "starter",
        months: 1,
        currency: "RUB",
        earlySeats: 0,
        now: NOW,
      });
      expect(plain.quote.amountMinor).toBe(290_00);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "applies the launch campaign to a year without anyone typing it",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      const year = await createOrder(db, {
        tenantId,
        plan: "pro",
        months: 12,
        currency: "RUB",
        earlySeats: 0,
        now: new Date("2026-10-21T12:00:00+03:00"),
      });
      const month = await createOrder(db, {
        tenantId,
        plan: "pro",
        months: 1,
        currency: "RUB",
        earlySeats: 0,
        now: new Date("2026-10-21T12:00:00+03:00"),
      });

      expect(year.quote.appliedCode).toBe("LAUNCH_RU");
      expect(year.quote.amountMinor).toBe(5_688_00);
      expect(month.quote.appliedCode).toBeNull();
    },
    DATABASE_TIMEOUT,
  );

  it(
    "counts a use only when the order is paid",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      await db
        .insert(schema.promoCodes)
        .values({ id: uuidv7(), code: "CHAT", kind: "community", percentOff: 15, maxUses: 1 });

      await createOrder(db, {
        tenantId,
        plan: "starter",
        months: 1,
        currency: "RUB",
        earlySeats: 0,
        promoCode: "CHAT",
        now: NOW,
      });
      const [unpaid] = await db
        .select()
        .from(schema.promoCodes)
        .where(eq(schema.promoCodes.code, "CHAT"));
      await pay(db, tenantId, { promoCode: "CHAT" });
      const [paid] = await db
        .select()
        .from(schema.promoCodes)
        .where(eq(schema.promoCodes.code, "CHAT"));

      expect(unpaid?.used).toBe(0);
      expect(paid?.used).toBe(1);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "gives a friend 28 days and the inviter one month, once per friend",
    async () => {
      const { db } = database;
      const inviter = await createTenant(db);
      await pay(db, inviter.tenantId);
      const code = await getReferralCode(db, inviter.tenantId);
      const friend = await createTenant(db);

      expect(
        await recordAcquisition(
          db,
          { tenantId: friend.tenantId, email: friend.email, referralCode: code.toLowerCase() },
          NOW,
        ),
      ).toBe("referral");
      expect((await tenantRow(db, friend.tenantId))?.trialEndsAt.toISOString()).toBe(
        new Date(NOW.getTime() + 28 * DAY_MS).toISOString(),
      );

      await pay(db, friend.tenantId);
      await pay(db, friend.tenantId, { at: new Date(NOW.getTime() + DAY_MS) });

      const freeMonths = await db
        .select({ periodStart: schema.paymentOrders.periodStart })
        .from(schema.paymentOrders)
        .where(
          and(
            eq(schema.paymentOrders.tenantId, inviter.tenantId),
            eq(schema.paymentOrders.provider, "referral"),
          ),
        );
      expect(freeMonths).toHaveLength(1);
      // Queued after the month the inviter already paid for.
      expect(freeMonths[0]?.periodStart?.toISOString()).toBe(
        new Date("2026-11-05T10:00:00Z").toISOString(),
      );
      expect(await getReferralStats(db, inviter.tenantId)).toMatchObject({
        signedUp: 1,
        rewarded: 1,
      });
    },
    DATABASE_TIMEOUT,
  );

  it(
    "does not let a person invite themselves",
    async () => {
      const { db } = database;
      const inviter = await createTenant(db, "same@example.com");
      const code = await getReferralCode(db, inviter.tenantId);
      const again = await createTenant(db, "other@example.com");

      const ownTenant = await recordAcquisition(
        db,
        { tenantId: inviter.tenantId, email: "same@example.com", referralCode: code },
        NOW,
      );
      const sameEmail = await recordAcquisition(
        db,
        { tenantId: again.tenantId, email: "SAME@example.com", referralCode: code },
        NOW,
      );

      expect([ownTenant, sameEmail]).toEqual(["organic", "organic"]);
      expect(await db.select().from(schema.referrals)).toHaveLength(0);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "starts an inviter's free month on Free after its trial, and moves it up that day",
    async () => {
      const { db } = database;
      const inviter = await createTenant(db);
      const code = await getReferralCode(db, inviter.tenantId);
      const friend = await createTenant(db);
      await recordAcquisition(
        db,
        { tenantId: friend.tenantId, email: friend.email, referralCode: code },
        NOW,
      );
      await pay(db, friend.tenantId);

      const trialEnd = (await tenantRow(db, inviter.tenantId))?.trialEndsAt ?? NOW;
      expect((await tenantRow(db, inviter.tenantId))?.plan).toBe("free");
      await expirePaidPlans(db, new Date(trialEnd.getTime() + 60_000));
      expect((await tenantRow(db, inviter.tenantId))?.plan).toBe("starter");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "gives a partner 30% of what was actually paid, once per payment",
    async () => {
      const { db } = database;
      await addPartner(db, { name: "Blogger", code: "blogger", contact: "@blogger" });
      const customer = await createTenant(db);
      await recordAcquisition(
        db,
        { tenantId: customer.tenantId, email: customer.email, promoCode: "BLOGGER" },
        NOW,
      );

      const { order, notification } = await pay(db, customer.tenantId, { months: 3 });
      await applyPaymentNotification(db, notification, NOW);
      await applyPaymentNotification(db, { ...notification, eventKey: "retry" }, NOW);

      // Starter 3 months: 790 × (1 − 0.2) = 632 ₽; 30% of that is 189.60 ₽.
      expect(order.quote.amountMinor).toBe(632_00);
      const earnings = await db.select().from(schema.partnerEarnings);
      expect(earnings.map((row) => row.amountMinor)).toEqual([189_60]);
      const [report] = await partnersReport(db, NOW, new Date(NOW.getTime() + 40 * DAY_MS));
      expect(report).toMatchObject({ name: "Blogger", payments: 1, earnedMinor: 189_60 });
    },
    DATABASE_TIMEOUT,
  );

  it(
    "sends one win-back a month after paid time ran out, and never a second",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      await pay(db, tenantId);
      const later = new Date("2026-12-10T10:00:00Z");
      await expirePaidPlans(db, later);

      expect(await listWinbackCandidates(db, later)).toEqual([tenantId]);
      const issued = await issueWinbackCode(db, tenantId, later);
      expect(issued?.code).toMatch(/^BACK-/);
      expect(await issueWinbackCode(db, tenantId, later)).toBeUndefined();
      expect(await listWinbackCandidates(db, later)).toEqual([]);

      const other = await createTenant(db);
      await expect(
        createOrder(db, {
          tenantId: other.tenantId,
          plan: "starter",
          months: 1,
          currency: "RUB",
          earlySeats: 0,
          promoCode: issued?.code,
          now: later,
        }),
      ).rejects.toMatchObject({ code: "promo_code_invalid" });
    },
    DATABASE_TIMEOUT,
  );

  it(
    "lengthens the trial with SELFHOST once",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);

      const until = await redeemTrialCode(db, tenantId, "selfhost", NOW);
      expect(until.toISOString()).toBe(new Date(NOW.getTime() + 30 * DAY_MS).toISOString());
      await expect(redeemTrialCode(db, tenantId, "SELFHOST", NOW)).rejects.toMatchObject({
        code: "promo_code_invalid",
      });
    },
    DATABASE_TIMEOUT,
  );
});
