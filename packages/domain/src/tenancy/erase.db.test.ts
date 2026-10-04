import { uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eraseTenant } from "./erase.js";

const DATABASE_TIMEOUT = 30_000;

async function addTenantWithOwner(
  db: Database,
  name: string,
  userId: string,
): Promise<{ tenantId: string; profileId: string }> {
  const tenantId = uuidv7();
  const profileId = uuidv7();
  await db.insert(schema.tenants).values({ id: tenantId, name });
  await db.insert(schema.memberships).values({ id: uuidv7(), tenantId, userId, role: "owner" });
  await db.insert(schema.watchProfiles).values({ id: profileId, tenantId, name: `${name} shop` });
  return { tenantId, profileId };
}

describe("erasing a tenant against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "removes the business, its data and its only-here users, and nobody else's",
    async () => {
      const { db } = database;
      const alone = uuidv7();
      const shared = uuidv7();
      const other = uuidv7();
      for (const [id, email] of [
        [alone, "alone@example.ru"],
        [shared, "shared@example.ru"],
        [other, "other@example.ru"],
      ] as const) {
        await db.insert(schema.user).values({ id, name: "", email });
      }

      const erased = await addTenantWithOwner(db, "Erased", alone);
      await db
        .insert(schema.memberships)
        .values({ id: uuidv7(), tenantId: erased.tenantId, userId: shared, role: "member" });
      const kept = await addTenantWithOwner(db, "Kept", other);
      await db
        .insert(schema.memberships)
        .values({ id: uuidv7(), tenantId: kept.tenantId, userId: shared, role: "member" });

      const result = await eraseTenant(db, erased.tenantId);

      expect(result.usersErased).toBe(1);
      expect(
        await db.select().from(schema.tenants).where(eq(schema.tenants.id, erased.tenantId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.watchProfiles)
          .where(eq(schema.watchProfiles.id, erased.profileId)),
      ).toHaveLength(0);
      expect(await db.select().from(schema.user).where(eq(schema.user.id, alone))).toHaveLength(0);
      expect(await db.select().from(schema.user).where(eq(schema.user.id, shared))).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.watchProfiles)
          .where(eq(schema.watchProfiles.id, kept.profileId)),
      ).toHaveLength(1);
    },
    DATABASE_TIMEOUT,
  );
});
