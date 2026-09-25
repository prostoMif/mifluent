import type { Queryable } from "@mifluent/db";
import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mifluent/domain", () => ({
  findTenantPlan: vi.fn(async () => ({
    name: "free" as const,
    limits: {
      maxTargets: 3,
      maxProfiles: 1,
      discoveryPerMonth: 1,
      diffIntervalMin: 1440,
      rawRetentionDays: 30,
      dailyDigest: false,
    },
  })),
}));

import { findTenantPlan } from "@mifluent/domain";
import { pruneExpiredMaterial, pruneRejections } from "./maintenance.js";

/**
 * A database that answers every read with one tenant and every delete with
 * nothing, and writes down which table each delete was aimed at. Enough to
 * assert what the job touches without a server.
 */
function recordingDb(): { db: Queryable; deleted: string[] } {
  const deleted: string[] = [];

  // Every builder method returns the same object, which also resolves to an
  // empty result — drizzle's chains differ per statement and none of that
  // matters here.
  const chain = (rows: unknown[]): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      // biome-ignore lint/suspicious/noThenProperty: a drizzle query builder is a thenable, and awaiting one is what this stands in for.
      then: (resolve: (value: unknown) => unknown) => resolve(rows),
    };
    for (const method of ["from", "where", "limit", "innerJoin", "leftJoin", "orderBy", "offset"]) {
      self[method] = () => self;
    }
    self["returning"] = () => chain([]);
    return self;
  };

  const db = {
    select: () => chain([{ id: "tenant-1" }]),
    delete: (table: unknown) => {
      deleted.push(getTableName(table as Parameters<typeof getTableName>[0]));
      return chain([]);
    },
  } as unknown as Queryable;

  return { db, deleted };
}

/** Never emptied by a TTL — only by deleting the account. */
const HISTORY_TABLES = [
  "events",
  "event_items",
  "facts",
  "digests",
  "digest_cards",
  "card_blocks",
  "user_actions",
  "decisions",
];

describe("pruneExpiredMaterial", () => {
  it("deletes only raw material", async () => {
    const { db, deleted } = recordingDb();

    await pruneExpiredMaterial(db, new Date("2026-09-24T00:00:00.000Z"));

    expect(deleted).toEqual(["chunks", "raw_items", "page_versions"]);
  });

  it("leaves every table that holds history alone", async () => {
    const { db, deleted } = recordingDb();

    await pruneExpiredMaterial(db, new Date("2026-09-24T00:00:00.000Z"));

    expect(deleted.filter((table) => HISTORY_TABLES.includes(table))).toEqual([]);
  });

  it("deletes nothing at all when the plan keeps raw material forever", async () => {
    vi.mocked(findTenantPlan).mockResolvedValueOnce({
      name: "team",
      limits: {
        maxTargets: 50,
        maxProfiles: 5,
        discoveryPerMonth: 20,
        diffIntervalMin: 60,
        rawRetentionDays: 0,
        dailyDigest: true,
      },
    });
    const { db, deleted } = recordingDb();

    const counts = await pruneExpiredMaterial(db, new Date("2026-09-24T00:00:00.000Z"));

    expect(deleted).toEqual([]);
    expect(counts).toEqual({ rawItems: 0, chunks: 0, pageVersions: 0 });
  });
});

describe("pruneRejections", () => {
  it("prunes rejections and nothing else", async () => {
    const { db, deleted } = recordingDb();

    await pruneRejections(db, new Date("2026-09-24T00:00:00.000Z"));

    expect(deleted).toEqual(["rejections"]);
  });
});
