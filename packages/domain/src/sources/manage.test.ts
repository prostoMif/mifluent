/**
 * Tenant isolation on adding a source — one of the three areas where
 * `docs/code-style.md` says a test is not optional.
 *
 * The profile is named in a request path and the row carries the caller's own
 * tenant, so the two can disagree. Nothing else in the insert would notice.
 */

import { AppError } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSource } from "./manage.js";

const TENANT = "0198f3aa-0000-7000-8000-000000000001";
const PROFILE = "0198f3aa-0000-7000-8000-000000000010";

const INPUT = {
  kind: "rss",
  label: "Their blog",
  locator: "https://example.com/feed",
  pollIntervalMinutes: 60,
} as const;

/** Answers the profile lookup with `rows`, and records what gets inserted. */
function fakeDb(rows: unknown[]): { db: Queryable; inserted: string[] } {
  const inserted: string[] = [];

  const chain = (result: unknown[]): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      // biome-ignore lint/suspicious/noThenProperty: a drizzle query builder is a thenable, and awaiting one is what this stands in for.
      then: (resolve: (value: unknown) => unknown) => resolve(result),
    };
    for (const method of ["from", "where", "limit", "values", "returning"]) {
      self[method] = () => self;
    }
    return self;
  };

  const db = {
    select: () => chain(rows),
    insert: (table: unknown) => {
      inserted.push(getTableName(table as Parameters<typeof getTableName>[0]));
      return chain([]);
    },
  } as unknown as Queryable;

  return { db, inserted };
}

describe("createSource", () => {
  it("adds the source when the profile belongs to the tenant", async () => {
    const { db, inserted } = fakeDb([{ id: PROFILE }]);

    await createSource({ db, tenantId: TENANT, profileId: PROFILE, input: INPUT });

    expect(inserted).toEqual(["sources"]);
  });

  it("refuses a profile that belongs to another tenant, and writes nothing", async () => {
    // The profile exists; it just does not match the tenant predicate, so the
    // scoped lookup finds no row — the same as a profile that is not there.
    const { db, inserted } = fakeDb([]);

    const create = createSource({ db, tenantId: TENANT, profileId: PROFILE, input: INPUT });

    await expect(create).rejects.toThrow(AppError);
    expect(inserted).toEqual([]);
  });

  it("says not found rather than forbidden about another tenant's profile", async () => {
    const { db } = fakeDb([]);

    try {
      await createSource({ db, tenantId: TENANT, profileId: PROFILE, input: INPUT });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("not_found");
    }
  });
});
