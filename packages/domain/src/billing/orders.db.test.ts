import { uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectivePlan } from "../plans/limits.js";
import {
  addMonths,
  applyPaymentNotification,
  closeEndedTrials,
  confirmRefund,
  createOrder,
  expirePaidPlans,
  grantManualPayment,
  listTrialReminders,
  requestRefund,
} from "./orders.js";

const DATABASE_TIMEOUT = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-15T10:00:00Z");

async function createTenant(
  db: Database,
  overrides: { trialEndsAt?: Date } = {},
): Promise<{ tenantId: string; profileId: string }> {
  const tenantId = uuidv7();
  const profileId = uuidv7();
  await db.insert(schema.tenants).values({ id: tenantId, name: "Shop", ...overrides });
  await db.insert(schema.watchProfiles).values({ id: profileId, tenantId, name: "Shop" });
  return { tenantId, profileId };
}

async function addTargets(db: Database, tenantId: string, profileId: string, total: number) {
  for (let index = 0; index < total; index += 1) {
    await db.insert(schema.watchTargets).values({
      id: uuidv7(),
      tenantId,
      profileId,
      kind: "competitor",
      name: `Competitor ${index}`,
      createdAt: new Date(NOW.getTime() - (total - index) * DAY_MS),
    });
  }
}

async function tenantPlan(db: Database, tenantId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ plan: schema.tenants.plan })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return row?.plan;
}

async function payFor(db: Database, tenantId: string, at: Date = NOW): Promise<string> {
  const order = await createOrder(db, {
    tenantId,
    plan: "pro",
    months: 1,
    currency: "RUB",
    earlySeats: 100,
  });
  await applyPaymentNotification(
    db,
    {
      eventKey: `event-${order.orderId}`,
      orderId: order.orderId,
      isPaid: true,
      paidAmountMinor: order.quote.amountMinor,
      payload: {},
    },
    at,
  );
  return order.orderId;
}

describe("payments against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "applies a payment once, however many times the notification arrives",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      const order = await createOrder(db, {
        tenantId,
        plan: "pro",
        months: 3,
        currency: "RUB",
        earlySeats: 100,
      });
      const notification = {
        eventKey: "prodamus-1",
        orderId: order.orderId,
        isPaid: true,
        paidAmountMinor: order.quote.amountMinor,
        payload: {},
      };

      const first = await applyPaymentNotification(db, notification, NOW);
      const second = await applyPaymentNotification(db, notification, NOW);
      const resentWithNewKey = await applyPaymentNotification(
        db,
        { ...notification, eventKey: "prodamus-2" },
        NOW,
      );

      const [paid] = await db
        .select({ periodEnd: schema.paymentOrders.periodEnd })
        .from(schema.paymentOrders)
        .where(eq(schema.paymentOrders.id, order.orderId));
      expect([first, second, resentWithNewKey]).toEqual(["applied", "duplicate", "duplicate"]);
      expect(paid?.periodEnd?.toISOString()).toBe(addMonths(NOW, 3).toISOString());
      expect(await tenantPlan(db, tenantId)).toBe("pro");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "refuses a notification for less money than the order",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      const order = await createOrder(db, {
        tenantId,
        plan: "team",
        months: 12,
        currency: "RUB",
        earlySeats: 100,
      });

      const outcome = await applyPaymentNotification(
        db,
        {
          eventKey: "cheap",
          orderId: order.orderId,
          isPaid: true,
          paidAmountMinor: 100,
          payload: {},
        },
        NOW,
      );

      expect(outcome).toBe("amount_mismatch");
      expect(await tenantPlan(db, tenantId)).toBe("free");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "gives the 101st Pro buyer the regular price, and keeps it early for an early buyer's renewal",
    async () => {
      const { db } = database;
      const early = await createTenant(db);
      await payFor(db, early.tenantId);

      const late = await createTenant(db);
      const lateOrder = await createOrder(db, {
        tenantId: late.tenantId,
        plan: "pro",
        months: 1,
        currency: "RUB",
        earlySeats: 1,
      });
      const renewal = await createOrder(db, {
        tenantId: early.tenantId,
        plan: "pro",
        months: 1,
        currency: "RUB",
        earlySeats: 1,
      });

      expect(lateOrder.quote.isEarly).toBe(false);
      expect(lateOrder.quote.amountMinor).toBe(790_00);
      expect(renewal.quote.isEarly).toBe(true);
      expect(renewal.quote.amountMinor).toBe(390_00);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "starts paid time where the current paid time ends, so paying early loses no days",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      await payFor(db, tenantId, NOW);
      const secondId = await payFor(db, tenantId, new Date(NOW.getTime() + 5 * DAY_MS));

      const [second] = await db
        .select({ periodStart: schema.paymentOrders.periodStart })
        .from(schema.paymentOrders)
        .where(eq(schema.paymentOrders.id, secondId));
      expect(second?.periodStart?.toISOString()).toBe(addMonths(NOW, 1).toISOString());
    },
    DATABASE_TIMEOUT,
  );

  it(
    "refunds within fourteen days: back to Free, extra targets paused, nothing deleted",
    async () => {
      const { db } = database;
      const { tenantId, profileId } = await createTenant(db, { trialEndsAt: NOW });
      await addTargets(db, tenantId, profileId, 6);
      await payFor(db, tenantId, NOW);

      const { orderId } = await requestRefund(db, tenantId, new Date(NOW.getTime() + 3 * DAY_MS));
      await confirmRefund(db, orderId, new Date(NOW.getTime() + 4 * DAY_MS));

      const targets = await db
        .select({ pausedAt: schema.watchTargets.pausedAt })
        .from(schema.watchTargets)
        .where(eq(schema.watchTargets.tenantId, tenantId));
      expect(await tenantPlan(db, tenantId)).toBe("free");
      expect(targets).toHaveLength(6);
      expect(targets.filter((target) => target.pausedAt === null)).toHaveLength(3);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "refuses a refund after fourteen days",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      await payFor(db, tenantId, NOW);

      await expect(
        requestRefund(db, tenantId, new Date(NOW.getTime() + 15 * DAY_MS)),
      ).rejects.toMatchObject({ code: "refund_window_closed" });
    },
    DATABASE_TIMEOUT,
  );

  it(
    "returns a tenant to Free when its paid month is over",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db, { trialEndsAt: NOW });
      await payFor(db, tenantId, NOW);

      const downgraded = await expirePaidPlans(db, new Date(NOW.getTime() + 40 * DAY_MS));

      expect(downgraded).toEqual([tenantId]);
      expect(await tenantPlan(db, tenantId)).toBe("free");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "leaves a plan the owner set by hand alone",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      await db.update(schema.tenants).set({ plan: "team" }).where(eq(schema.tenants.id, tenantId));

      await expirePaidPlans(db, new Date(NOW.getTime() + 400 * DAY_MS));

      expect(await tenantPlan(db, tenantId)).toBe("team");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "pauses targets beyond Free when the trial ends, and deletes none",
    async () => {
      const { db } = database;
      const { tenantId, profileId } = await createTenant(db, {
        trialEndsAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      });
      await addTargets(db, tenantId, profileId, 5);

      const closed = await closeEndedTrials(db, NOW);

      const targets = await db
        .select({ pausedAt: schema.watchTargets.pausedAt })
        .from(schema.watchTargets)
        .where(eq(schema.watchTargets.tenantId, tenantId));
      expect(closed).toEqual([tenantId]);
      expect(targets.filter((target) => target.pausedAt !== null)).toHaveLength(2);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "reminds three days before the trial ends and on the last day",
    async () => {
      const { db } = database;
      const threeDays = await createTenant(db, {
        trialEndsAt: new Date(NOW.getTime() + 2.5 * DAY_MS),
      });
      const lastDay = await createTenant(db, {
        trialEndsAt: new Date(NOW.getTime() + 0.5 * DAY_MS),
      });
      await createTenant(db, { trialEndsAt: new Date(NOW.getTime() + 1.5 * DAY_MS) });

      const reminders = await listTrialReminders(db, NOW);

      expect(reminders).toEqual(
        expect.arrayContaining([
          { tenantId: threeDays.tenantId, daysLeft: 3 },
          { tenantId: lastDay.tenantId, daysLeft: 1 },
        ]),
      );
      expect(reminders).toHaveLength(2);
    },
    DATABASE_TIMEOUT,
  );
});

describe("effectivePlan", () => {
  it("gives Pro during the trial", () => {
    expect(
      effectivePlan({ plan: "free", trialEndsAt: new Date(NOW.getTime() + DAY_MS) }, NOW),
    ).toBe("pro");
  });

  it("gives Free after the trial", () => {
    expect(
      effectivePlan({ plan: "free", trialEndsAt: new Date(NOW.getTime() - DAY_MS) }, NOW),
    ).toBe("free");
  });

  it("gives the paid plan whatever the trial says", () => {
    expect(
      effectivePlan({ plan: "starter", trialEndsAt: new Date(NOW.getTime() + DAY_MS) }, NOW),
    ).toBe("starter");
  });
});

describe("payments taken by hand", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "starts a new account on Free, with no trial",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);
      const [row] = await db
        .select({ plan: schema.tenants.plan, trialEndsAt: schema.tenants.trialEndsAt })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId));

      expect(effectivePlan(row, new Date(Date.now() + 1000))).toBe("free");
    },
    DATABASE_TIMEOUT,
  );

  it(
    "records the amount actually paid and switches the plan on for the term",
    async () => {
      const { db } = database;
      const { tenantId } = await createTenant(db);

      const orderId = await grantManualPayment(db, {
        tenantId,
        plan: "pro",
        months: 12,
        amountMinor: 199_000,
        currency: "RUB",
        now: NOW,
      });

      const [order] = await db
        .select()
        .from(schema.paymentOrders)
        .where(eq(schema.paymentOrders.id, orderId));
      expect(order?.provider).toBe("manual");
      expect(order?.status).toBe("paid");
      expect(order?.amountMinor).toBe(199_000);
      expect(order?.periodEnd?.toISOString()).toBe(addMonths(NOW, 12).toISOString());
      expect(await tenantPlan(db, tenantId)).toBe("pro");
    },
    DATABASE_TIMEOUT,
  );
});
