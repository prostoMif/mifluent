/**
 * Tests for target history queries.
 */

import type { Queryable } from "@mifluent/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchCheckCount,
  fetchPriceChanges,
  fetchTargetHeader,
  fetchTargetTimeline,
  fetchVacancies,
} from "./history.js";

// Mock database
const createMockDb = () => {
  let mockResolvedValue: unknown = [];
  const mockResolvedValues: unknown[] = [];
  let callIndex = 0;

  const mockSelect = vi.fn().mockReturnThis();
  const mockFrom = vi.fn().mockReturnThis();
  const mockWhere = vi.fn().mockReturnThis();
  const mockLeftJoin = vi.fn().mockReturnThis();
  const mockOrderBy = vi.fn().mockReturnThis();
  const mockLimit = vi.fn().mockReturnThis();
  const mockInnerJoin = vi.fn().mockReturnThis();

  const chain = {
    select: mockSelect,
    from: mockFrom,
    where: mockWhere,
    leftJoin: mockLeftJoin,
    orderBy: mockOrderBy,
    limit: mockLimit,
    innerJoin: mockInnerJoin,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for query chain await
    then(onFulfilled: (value: unknown) => unknown) {
      const value =
        mockResolvedValues.length > callIndex ? mockResolvedValues[callIndex++] : mockResolvedValue;
      return Promise.resolve(value).then(onFulfilled);
    },
    mockResolvedValue(value: unknown) {
      mockResolvedValue = value;
      return chain;
    },
    mockResolvedValueOnce(value: unknown) {
      mockResolvedValues.push(value);
      return chain;
    },
  };

  // Make the chain methods return the chain itself
  const chainMethods = [
    mockSelect,
    mockFrom,
    mockWhere,
    mockLeftJoin,
    mockOrderBy,
    mockLimit,
    mockInnerJoin,
  ];
  for (const fn of chainMethods) {
    fn.mockReturnThis();
  }

  return chain as unknown as Queryable & {
    select: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    leftJoin: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    mockResolvedValue: (value: unknown) => typeof chain;
    mockResolvedValueOnce: (value: unknown) => typeof chain;
  };
};

describe("fetchTargetHeader", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("returns undefined when target not found", async () => {
    db.mockResolvedValueOnce([]);

    const result = await fetchTargetHeader(db, "tenant-1", "target-1");
    expect(result).toBeUndefined();
  });

  it("returns target header with surfaces", async () => {
    db.mockResolvedValueOnce([
      {
        id: "target-1",
        name: "Competitor Inc",
        kind: "competitor",
        websiteUrl: "https://competitor.com",
        reason: "Main competitor",
        pausedAt: null,
        profileId: "profile-1",
      },
    ]).mockResolvedValueOnce([
      { kind: "rss" },
      { kind: "diff" },
      { kind: "rss" }, // duplicate
    ]);

    const result = await fetchTargetHeader(db, "tenant-1", "target-1");

    expect(result).toEqual({
      id: "target-1",
      name: "Competitor Inc",
      kind: "competitor",
      websiteUrl: "https://competitor.com",
      reason: "Main competitor",
      pausedAt: null,
      profileId: "profile-1",
      surfaces: ["diff", "rss"],
    });
  });
});

describe("fetchTargetTimeline", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("merges events and decisions sorted by time", async () => {
    db.mockResolvedValueOnce([
      {
        id: "event-1",
        kind: "event",
        occurredAt: new Date("2026-01-15"),
        eventKind: "price",
        summary: "Price increased",
        quote: null,
        sourceUrl: "https://example.com",
        isUrgent: false,
        decisionText: null,
        revisitAt: null,
      },
    ]).mockResolvedValueOnce([
      {
        id: "decision-1",
        kind: "decision",
        occurredAt: new Date("2026-01-20"),
        eventKind: null,
        summary: "Decided to match price",
        quote: null,
        sourceUrl: null,
        isUrgent: false,
        decisionText: "Decided to match price",
        revisitAt: new Date("2026-02-01"),
      },
    ]);

    const result = await fetchTargetTimeline(db, "tenant-1", "target-1");

    expect(result.entries).toHaveLength(2);
    // Decision is more recent, should come first
    expect(result.entries[0]?.id).toBe("decision-1");
    expect(result.entries[1]?.id).toBe("event-1");
    expect(result.hasMore).toBe(false);
  });

  it("respects cursor for pagination", async () => {
    db.mockResolvedValue([]);

    await fetchTargetTimeline(db, "tenant-1", "target-1", {
      cursor: new Date("2026-01-01"),
    });

    expect(db.where).toHaveBeenCalled();
  });

  it("filters by event kind", async () => {
    db.mockResolvedValue([]);

    await fetchTargetTimeline(db, "tenant-1", "target-1", {
      eventKindFilter: "price",
    });

    expect(db.where).toHaveBeenCalled();
  });
});

describe("fetchPriceChanges", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("returns empty array when no price/plan events", async () => {
    db.mockResolvedValueOnce([]);

    const result = await fetchPriceChanges(db, "tenant-1", "target-1");
    expect(result).toEqual([]);
  });

  it("computes was → became from consecutive same-kind events", async () => {
    db.mockResolvedValueOnce([
      {
        id: "event-3",
        occurredAt: new Date("2026-01-20"),
        kind: "price",
        summary: "$99/mo",
        quote: null,
        sourceUrl: "https://example.com/3",
      },
      {
        id: "event-2",
        occurredAt: new Date("2026-01-15"),
        kind: "price",
        summary: "$79/mo",
        quote: null,
        sourceUrl: "https://example.com/2",
      },
      {
        id: "event-1",
        occurredAt: new Date("2026-01-10"),
        kind: "plan",
        summary: "Pro plan launched",
        quote: null,
        sourceUrl: "https://example.com/1",
      },
    ]);

    const result = await fetchPriceChanges(db, "tenant-1", "target-1");

    expect(result).toHaveLength(2);
    // First change: price $79 → $99 (occurred at the time of the newer event)
    expect(result[0]).toEqual({
      occurredAt: new Date("2026-01-20"),
      kind: "price",
      was: "$79/mo",
      became: "$99/mo",
      quote: null,
      sourceUrl: "https://example.com/3",
    });
    // Second change: plan (only one plan event, so was=null)
    expect(result[1]).toEqual({
      occurredAt: new Date("2026-01-10"),
      kind: "plan",
      was: null,
      became: "Pro plan launched",
      quote: null,
      sourceUrl: "https://example.com/1",
    });
  });

  it("handles single baseline event", async () => {
    db.mockResolvedValueOnce([
      {
        id: "event-1",
        occurredAt: new Date("2026-01-10"),
        kind: "price",
        summary: "$49/mo baseline",
        quote: null,
        sourceUrl: "https://example.com/1",
      },
    ]);

    const result = await fetchPriceChanges(db, "tenant-1", "target-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      occurredAt: new Date("2026-01-10"),
      kind: "price",
      was: null,
      became: "$49/mo baseline",
      quote: null,
      sourceUrl: "https://example.com/1",
    });
  });
});

describe("fetchVacancies", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("returns empty when no ATS sources", async () => {
    db.mockResolvedValueOnce([]);

    const result = await fetchVacancies(db, "tenant-1", "target-1");
    expect(result).toEqual([]);
  });

  it("parses vacancies from latest ATS snapshot", async () => {
    db.mockResolvedValueOnce([{ id: "source-1" }]) // ATS sources
      .mockResolvedValueOnce([
        {
          id: "item-1",
          sourceId: "source-1",
          content: JSON.stringify([
            {
              title: "Senior Engineer",
              url: "https://jobs.com/1",
              department: "Engineering",
              location: "Remote",
            },
            { title: "Designer", url: "https://jobs.com/2", department: "Design", location: "NYC" },
          ]),
          metadata: {},
          fetchedAt: new Date("2026-01-15"),
          url: "https://competitor.com/jobs",
        },
      ])
      .mockResolvedValueOnce([]); // historical items

    const result = await fetchVacancies(db, "tenant-1", "target-1");

    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("Senior Engineer");
    expect(result[0]?.department).toBe("Engineering");
    expect(result[0]?.isOpen).toBe(true);
  });

  it("handles invalid JSON gracefully", async () => {
    db.mockResolvedValueOnce([{ id: "source-1" }])
      .mockResolvedValueOnce([
        {
          id: "item-1",
          sourceId: "source-1",
          content: "not valid json",
          metadata: {},
          fetchedAt: new Date("2026-01-15"),
          url: "https://competitor.com/jobs",
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await fetchVacancies(db, "tenant-1", "target-1");
    expect(result).toEqual([]);
  });
});

describe("fetchCheckCount", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("returns 0 when no sources", async () => {
    db.mockResolvedValueOnce([]);

    const result = await fetchCheckCount(db, "tenant-1", "target-1", 30);
    expect(result).toBe(0);
  });

  it("counts raw items in period", async () => {
    db.mockResolvedValueOnce([{ id: "source-1" }, { id: "source-2" }]).mockResolvedValueOnce([
      { count: 42 },
    ]);

    const result = await fetchCheckCount(db, "tenant-1", "target-1", 30);
    expect(result).toBe(42);
  });
});

describe("getHistoryDaysLimit", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("returns how far back the plan shows the archive", async () => {
    // Reset modules to clear cache
    vi.resetModules();

    // Mock config to avoid env var requirements
    vi.doMock("@mifluent/core", () => ({
      getConfig: vi.fn().mockReturnValue({
        planOverrides: {},
      }),
    }));

    // Mock findTenantPlan
    vi.doMock("../plans/limits.js", () => ({
      findTenantPlan: vi.fn().mockResolvedValue({
        name: "free",
        limits: {
          maxTargets: 3,
          maxProfiles: 1,
          discoveryPerMonth: 1,
          diffIntervalMin: 1440,
          rawRetentionDays: 365,
          dailyDigest: false,
          maxWatchedPages: 1,
          historyDays: 30,
        },
      }),
    }));

    // Dynamic import to get the mocked version
    const { getHistoryDaysLimit: getHistoryDaysLimitMocked } = await import("./history.js");

    const result = await getHistoryDaysLimitMocked(db, "tenant-1");
    expect(result).toBe(30);
  });
});
