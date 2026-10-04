import { resetConfigCache, uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addCompetitors } from "./add-competitors.js";

const DATABASE_TIMEOUT = 30_000;
const REASON = "Конкурент из 2ГИС: Стоматологии, Казань";

async function createProfile(db: Database): Promise<{ tenantId: string; profileId: string }> {
  const tenantId = uuidv7();
  const profileId = uuidv7();
  await db.insert(schema.tenants).values({ id: tenantId, name: "Клиника" });
  await db.insert(schema.watchProfiles).values({ id: profileId, tenantId, name: "Клиника" });
  await db.insert(schema.watchTargets).values({
    id: uuidv7(),
    tenantId,
    profileId,
    kind: "competitor",
    name: "Улыбка",
    websiteUrl: "https://ulybka.ru",
  });
  return { tenantId, profileId };
}

async function targetNames(db: Database, profileId: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.watchTargets.name })
    .from(schema.watchTargets)
    .where(
      and(eq(schema.watchTargets.profileId, profileId), isNull(schema.watchTargets.deletedAt)),
    );
  return rows.map((row) => row.name).sort();
}

describe("adding competitors against a real database", () => {
  let database: TestDatabase;

  // Plan limits read the configuration; these are the variables it requires.
  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://unused");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(40));
    vi.stubEnv("BETTER_AUTH_URL", "https://test.example");
    vi.stubEnv("ENCRYPTION_KEY", "e".repeat(40));
    vi.stubEnv("APP_URL", "https://test.example");
    resetConfigCache();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "adds new competitors, keeps what was there, skips a known name or site",
    async () => {
      const { db } = database;
      const { tenantId, profileId } = await createProfile(db);

      const added = await addCompetitors({
        db,
        tenantId,
        profileId,
        changeReason: "2GIS",
        competitors: [
          { name: "Дента Плюс", websiteUrl: "https://denta-plus.ru", reason: REASON },
          { name: "улыбка", websiteUrl: "https://other.ru", reason: REASON },
          { name: "Улыбка-2", websiteUrl: "https://www.ulybka.ru/", reason: REASON },
        ],
      });

      expect(added.map((competitor) => competitor.name)).toEqual(["Дента Плюс"]);
      expect(await targetNames(db, profileId)).toEqual(["Дента Плюс", "Улыбка"]);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "writes nothing into another tenant's profile",
    async () => {
      const { db } = database;
      const { profileId } = await createProfile(db);
      const stranger = await createProfile(db);

      await expect(
        addCompetitors({
          db,
          tenantId: stranger.tenantId,
          profileId,
          changeReason: "2GIS",
          competitors: [
            { name: "Дента Плюс", websiteUrl: "https://denta-plus.ru", reason: REASON },
          ],
        }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(await targetNames(db, profileId)).toEqual(["Улыбка"]);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "holds the plan's target limit",
    async () => {
      const { db } = database;
      const { tenantId, profileId } = await createProfile(db);
      const many = Array.from({ length: 30 }, (_, index) => ({
        name: `Клиника ${index}`,
        websiteUrl: `https://clinic-${index}.ru`,
        reason: REASON,
      }));

      await expect(
        addCompetitors({ db, tenantId, profileId, changeReason: "2GIS", competitors: many }),
      ).rejects.toMatchObject({ code: "plan_limit_reached" });
      expect(await targetNames(db, profileId)).toEqual(["Улыбка"]);
    },
    DATABASE_TIMEOUT,
  );
});
