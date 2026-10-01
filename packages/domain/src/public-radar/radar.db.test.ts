import { uuidv7 } from "@mifluent/core";
import { type Database, schema } from "@mifluent/db";
import { createTestDatabase, type TestDatabase } from "@mifluent/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RadarFile } from "./files.js";
import { DAILY_DRAFT_LIMIT, draftRadarPosts } from "./posts.js";
import { findPublicCompanyPage, listPublicChanges, listPublicCompanies } from "./public.js";
import { syncRadar } from "./sync.js";

const DATABASE_TIMEOUT = 30_000;
const NOW = new Date("2026-10-15T10:00:00Z");

const FILE: RadarFile = {
  profile: {
    name: "Radar — SaaS (en)",
    language: "en",
    description: "Pricing, plan and policy changes at well-known SaaS companies.",
  },
  companies: ["Notion", "Figma", "Slack", "Linear", "Vercel"].map((name) => ({
    name,
    website: `https://${name.toLowerCase()}.com`,
    category: "saas",
    surfaces: [
      {
        type: "diff" as const,
        url: `https://${name.toLowerCase()}.com/pricing`,
        label: "Pricing page",
        interval_minutes: 720,
      },
    ],
  })),
};

async function createTenant(db: Database): Promise<string> {
  const tenantId = uuidv7();
  await db.insert(schema.tenants).values({ id: tenantId, name: "Tenant" });
  return tenantId;
}

/** A verified event about a target: an event row and one fact with its quote. */
async function addEvent(
  db: Database,
  input: { tenantId: string; profileId: string; targetId: string; kind: string; summary: string },
): Promise<string> {
  const [profile] = await db
    .select({ versionId: schema.watchProfiles.currentVersionId })
    .from(schema.watchProfiles)
    .where(eq(schema.watchProfiles.id, input.profileId));
  const eventId = uuidv7();
  await db.insert(schema.events).values({
    id: eventId,
    tenantId: input.tenantId,
    profileId: input.profileId,
    profileVersionId: profile?.versionId ?? uuidv7(),
    targetId: input.targetId,
    relevanceScore: 0.9,
    summary: input.summary,
    implication: "Private: why it matters to this customer",
    kind: input.kind,
    sourceUrl: "https://example.com/pricing",
    occurredAt: NOW,
  });
  await db.insert(schema.facts).values({
    id: uuidv7(),
    tenantId: input.tenantId,
    eventId,
    statement: input.summary,
    quote: "Plus is now $12 per seat.",
    quoteStartOffset: 0,
    quoteEndOffset: 25,
  });
  return eventId;
}

async function createCustomerWithEvent(db: Database): Promise<void> {
  const tenantId = await createTenant(db);
  const result = await syncRadar(db, tenantId, {
    ...FILE,
    profile: { ...FILE.profile, name: "Customer profile" },
    companies: [{ ...FILE.companies[0], name: "Notion" } as RadarFile["companies"][number]],
  });
  const [target] = await db
    .select({ id: schema.watchTargets.id })
    .from(schema.watchTargets)
    .where(eq(schema.watchTargets.tenantId, tenantId));
  await addEvent(db, {
    tenantId,
    profileId: result.profileId,
    targetId: target?.id ?? "",
    kind: "price",
    summary: "SECRET customer event",
  });
}

describe("the public radar against a real database", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  }, DATABASE_TIMEOUT);

  afterEach(async () => {
    await database.close();
  });

  it(
    "creates five targets and their sources, and nothing more the second time",
    async () => {
      const { db } = database;
      const radar = await createTenant(db);

      const first = await syncRadar(db, radar, FILE);
      const second = await syncRadar(db, radar, FILE);

      expect(first).toMatchObject({ profileCreated: true, targetsCreated: 5, sourcesCreated: 5 });
      expect(second).toMatchObject({ profileCreated: false, targetsCreated: 0, sourcesCreated: 0 });
      expect(await db.select().from(schema.watchTargets)).toHaveLength(5);
      expect(await db.select().from(schema.sources)).toHaveLength(5);
    },
    DATABASE_TIMEOUT,
  );

  it(
    "shows only the radar tenant's events, and only public fields",
    async () => {
      const { db } = database;
      const radar = await createTenant(db);
      const { profileId } = await syncRadar(db, radar, FILE);
      const [notion] = await db
        .select({ id: schema.watchTargets.id })
        .from(schema.watchTargets)
        .where(eq(schema.watchTargets.name, "Notion"));
      await addEvent(db, {
        tenantId: radar,
        profileId,
        targetId: notion?.id ?? "",
        kind: "price",
        summary: "Notion raised Plus to $12",
      });
      await createCustomerWithEvent(db);

      const changes = await listPublicChanges(db, radar);
      const page = await findPublicCompanyPage(db, radar, "notion");
      const companies = await listPublicCompanies(db, radar);

      expect(changes.map((change) => change.summary)).toEqual(["Notion raised Plus to $12"]);
      expect(Object.keys(changes[0] ?? {}).sort()).toEqual(
        [
          "company",
          "kind",
          "language",
          "occurredAt",
          "quote",
          "slug",
          "sourceUrl",
          "summary",
        ].sort(),
      );
      expect(JSON.stringify([changes, page, companies])).not.toMatch(
        /SECRET|Private|[0-9a-f]{8}-[0-9a-f]{4}-7/,
      );
      expect(page?.changes).toHaveLength(1);
      expect(companies).toHaveLength(5);
      expect(await findPublicCompanyPage(db, radar, "no-such-company")).toBeUndefined();
    },
    DATABASE_TIMEOUT,
  );

  it(
    "drafts at most five posts a day per language, prices first, and never one event twice",
    async () => {
      const { db } = database;
      const radar = await createTenant(db);
      const { profileId } = await syncRadar(db, radar, FILE);
      const targets = await db.select({ id: schema.watchTargets.id }).from(schema.watchTargets);
      const eventIds: string[] = [];
      for (const [index, target] of targets.entries()) {
        eventIds.push(
          await addEvent(db, {
            tenantId: radar,
            profileId,
            targetId: target.id,
            kind: "feature",
            summary: `Feature ${index}`,
          }),
          await addEvent(db, {
            tenantId: radar,
            profileId,
            targetId: target.id,
            kind: "price",
            summary: `Price ${index}`,
          }),
        );
      }
      eventIds.push(
        await addEvent(db, {
          tenantId: radar,
          profileId,
          targetId: targets[0]?.id ?? "",
          kind: "hiring",
          summary: "Hiring",
        }),
      );

      const drafts = await draftRadarPosts(db, radar, eventIds, NOW);
      const again = await draftRadarPosts(db, radar, eventIds, NOW);
      const rows = await db.select({ status: schema.radarPosts.status }).from(schema.radarPosts);

      expect(drafts).toHaveLength(DAILY_DRAFT_LIMIT);
      expect(drafts.every((draft) => draft.kind === "price")).toBe(true);
      expect(again).toHaveLength(0);
      // Ten price/feature events become rows; hiring is not a post.
      expect(rows).toHaveLength(10);
      expect(rows.filter((row) => row.status === "queued")).toHaveLength(5);
    },
    DATABASE_TIMEOUT,
  );
});
