import { uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachUserToInstance } from "./membership.js";

const DATABASE_TIMEOUT = 30_000;

async function createUser(db: Database, email: string): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.user).values({ id, name: email, email });
  return id;
}

describe("joining a tenant against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "gives two strangers two tenants, each its own owner",
    async () => {
      const { db } = database;
      const first = await attachUserToInstance({
        db,
        userId: await createUser(db, "a@example.com"),
        tenantName: "A",
        timezone: "UTC",
      });
      const second = await attachUserToInstance({
        db,
        userId: await createUser(db, "b@example.com"),
        tenantName: "B",
        timezone: "UTC",
      });

      expect(second.tenantId).not.toBe(first.tenantId);
      expect([first.role, second.role]).toEqual(["owner", "owner"]);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "puts an invited account in the inviting tenant, in the invited role",
    async () => {
      const { db } = database;
      const owner = await attachUserToInstance({
        db,
        userId: await createUser(db, "owner@example.com"),
        tenantName: "Shop",
        timezone: "UTC",
      });
      const invited = await attachUserToInstance({
        db,
        userId: await createUser(db, "colleague@example.com"),
        tenantName: "ignored",
        timezone: "UTC",
        invitation: { tenantId: owner.tenantId, role: "member" },
      });

      expect(invited).toMatchObject({ tenantId: owner.tenantId, role: "member" });
    },
    DATABASE_TIMEOUT,
  );

  it(
    "returns the same membership when called twice for one account",
    async () => {
      const { db } = database;
      const userId = await createUser(db, "twice@example.com");
      const options = { db, userId, tenantName: "Twice", timezone: "UTC" };

      const first = await attachUserToInstance(options);
      const again = await attachUserToInstance(options);
      const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);

      expect(again).toEqual(first);
      expect(tenants).toHaveLength(1);
    },
    DATABASE_TIMEOUT,
  );
});
