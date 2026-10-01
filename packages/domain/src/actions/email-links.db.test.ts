import { uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findEmailCard,
  pauseEmailDelivery,
  recordEmailCardAction,
  resumeEmailDelivery,
} from "./email-links.js";

const DATABASE_TIMEOUT = 30_000;
const NOW = new Date("2026-10-15T10:00:00Z");

interface Fixture {
  readonly tenantId: string;
  readonly profileId: string;
  readonly targetId: string;
  readonly cardId: string;
}

async function createCard(db: Database): Promise<Fixture> {
  const tenantId = uuidv7();
  const profileId = uuidv7();
  const versionId = uuidv7();
  const targetId = uuidv7();
  const eventId = uuidv7();
  const digestId = uuidv7();
  const cardId = uuidv7();
  await db.insert(schema.tenants).values({ id: tenantId, name: "Shop" });
  await db.insert(schema.watchProfiles).values({
    id: profileId,
    tenantId,
    name: "Shop",
    delivery: { channel: "email" },
  });
  await db
    .insert(schema.watchProfileVersions)
    .values({ id: versionId, tenantId, profileId, version: 1, snapshot: {} });
  await db
    .insert(schema.watchTargets)
    .values({ id: targetId, tenantId, profileId, kind: "competitor", name: "Rival" });
  await db.insert(schema.events).values({
    id: eventId,
    tenantId,
    profileId,
    profileVersionId: versionId,
    targetId,
    relevanceScore: 0.9,
    summary: "Rival raised prices",
  });
  await db.insert(schema.digests).values({
    id: digestId,
    tenantId,
    profileId,
    profileVersionId: versionId,
    periodStart: NOW,
    periodEnd: NOW,
    channel: "email",
  });
  await db.insert(schema.digestCards).values({
    id: cardId,
    tenantId,
    digestId,
    eventId,
    position: 0,
    headline: "Rival raised prices",
  });
  return { tenantId, profileId, targetId, cardId };
}

async function emailPausedAt(db: Database, profileId: string): Promise<unknown> {
  const [row] = await db
    .select({ delivery: schema.watchProfiles.delivery })
    .from(schema.watchProfiles)
    .where(eq(schema.watchProfiles.id, profileId));
  return row?.delivery.emailPausedAt ?? null;
}

describe("email links against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "records a press from an email in the card's own tenant and pauses the target",
    async () => {
      const { db } = database;
      const fixture = await createCard(db);

      expect(await findEmailCard(db, fixture.cardId)).toEqual({ headline: "Rival raised prices" });
      expect(await recordEmailCardAction(db, fixture.cardId, "not_following_target")).toBe(true);

      const actions = await db
        .select({ tenantId: schema.userActions.tenantId, surface: schema.userActions.surface })
        .from(schema.userActions);
      const [target] = await db
        .select({ pausedAt: schema.watchTargets.pausedAt })
        .from(schema.watchTargets)
        .where(eq(schema.watchTargets.id, fixture.targetId));
      expect(actions).toEqual([{ tenantId: fixture.tenantId, surface: "email" }]);
      expect(target?.pausedAt).not.toBeNull();
    },
    DATABASE_TIMEOUT,
  );

  it(
    "does nothing for a card that does not exist",
    async () => {
      const { db } = database;
      expect(await recordEmailCardAction(db, uuidv7(), "saved")).toBe(false);
      expect(await findEmailCard(db, uuidv7())).toBeUndefined();
    },
    DATABASE_TIMEOUT,
  );

  it(
    "stops email, keeps the first date on a repeat, and starts it again",
    async () => {
      const { db } = database;
      const { profileId } = await createCard(db);

      await pauseEmailDelivery(db, profileId, NOW);
      await pauseEmailDelivery(db, profileId, new Date(NOW.getTime() + 60_000));
      const paused = await emailPausedAt(db, profileId);
      await resumeEmailDelivery(db, profileId, NOW);
      const resumed = await emailPausedAt(db, profileId);
      await pauseEmailDelivery(db, profileId, NOW);

      expect(new Date(String(paused)).toISOString()).toBe(NOW.toISOString());
      expect(resumed).toBeNull();
      expect(await emailPausedAt(db, profileId)).not.toBeNull();
    },
    DATABASE_TIMEOUT,
  );
});
