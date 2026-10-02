import { uuidv7 } from "@mifluent/core";
import { schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportTenantData } from "./export.js";

const DATABASE_TIMEOUT = 30_000;

describe("exporting a tenant's data against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "contains this tenant's profiles and targets and nobody else's",
    async () => {
      const { db } = database;
      const ids = [uuidv7(), uuidv7()];
      for (const [index, tenantId] of ids.entries()) {
        const profileId = uuidv7();
        await db.insert(schema.tenants).values({ id: tenantId, name: `T${index}` });
        await db
          .insert(schema.watchProfiles)
          .values({ id: profileId, tenantId, name: `Shop ${index}` });
        await db.insert(schema.watchTargets).values({
          id: uuidv7(),
          tenantId,
          profileId,
          kind: "competitor",
          name: `Rival ${index}`,
        });
      }

      const exported = await exportTenantData(db, ids[0] ?? "");

      expect(exported.profiles.map((profile) => profile.name)).toEqual(["Shop 0"]);
      expect(exported.targets.map((target) => target.name)).toEqual(["Rival 0"]);
      expect(JSON.stringify(exported)).not.toContain("Rival 1");
    },
    DATABASE_TIMEOUT,
  );
});
