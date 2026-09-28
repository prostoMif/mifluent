import type { Logger } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import type { EmbeddingProvider } from "@mifluent/embeddings";
import type { LlmClient } from "@mifluent/llm";
import { describe, expect, it, vi } from "vitest";
import type { CostGuard } from "../guard.js";
import type { ProfileContext } from "../profile.js";
import { priorityOf } from "./priority.js";
import { type SelectionOptions, selectForProfile } from "./select.js";

const tenantId = "t-tenant";
const profileId = "t-profile";
const versionId = "t-version";
const targetId = "t-target";

const mockContext: ProfileContext = {
  tenantId,
  profileId,
  versionId,
  name: "Test Profile",
  businessDescription: "A test business",
  relevanceThreshold: 0.5,
  facts: {},
  language: "en",
  targets: [{ id: targetId, kind: "competitor", name: "Competitor", reason: null, aliases: [] }],
  topics: [],
  stopwords: ["webinar"],
};

function createMockDb(candidates: unknown[] = [], vectors: Map<string, number[][]> = new Map()) {
  let queryIndex = 0;

  function buildVectorRows(): Array<{ itemId: string; vector: number[] }> {
    const rows: Array<{ itemId: string; vector: number[] }> = [];
    for (const [itemId, vecs] of vectors) {
      for (const v of vecs) {
        rows.push({ itemId, vector: v });
      }
    }
    return rows;
  }

  function isCandidatesQuery(tableName: string | undefined, index: number): boolean {
    return tableName === "raw_items" || index === 1;
  }

  function isVectorsQuery(tableName: string | undefined, index: number): boolean {
    return tableName === "chunks" || index === 2;
  }

  function getVectorsResult() {
    return Promise.resolve(buildVectorRows());
  }

  function getEmptyResult() {
    return Promise.resolve([]);
  }

  const createSelectChain = (tableName?: string) => {
    const chain: Record<string, unknown> = {
      from: vi.fn((table) => createSelectChain(table?.name)),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => {
        queryIndex += 1;
        if (isCandidatesQuery(tableName, queryIndex)) return Promise.resolve(candidates);
        if (isVectorsQuery(tableName, queryIndex)) return getVectorsResult();
        return getEmptyResult();
      }),
      // biome-ignore lint/suspicious/noThenProperty: needed for awaitable query chain
      then: vi.fn((resolve) => {
        if (isVectorsQuery(tableName, queryIndex)) return getVectorsResult().then(resolve);
        return getEmptyResult().then(resolve);
      }),
    };
    return chain;
  };

  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateChain),
    returning: vi.fn(() => Promise.resolve([])),
  };

  const insertChain = {
    values: vi.fn(() => Promise.resolve()),
  };

  // Transaction chain
  const transactionChain = {
    select: vi.fn((table) => createSelectChain(table?.name)),
    update: vi.fn(() => updateChain),
    insert: vi.fn(() => insertChain),
    innerJoin: vi.fn(() => transactionChain),
    where: vi.fn(() => transactionChain),
    orderBy: vi.fn(() => transactionChain),
    limit: vi.fn(() => Promise.resolve([])),
    from: vi.fn(() => transactionChain),
    set: vi.fn(() => transactionChain),
    returning: vi.fn(() => Promise.resolve([])),
  };

  return {
    select: vi.fn((table) => createSelectChain(table?.name)),
    update: vi.fn(() => updateChain),
    insert: vi.fn(() => insertChain),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(transactionChain)),
  } as unknown as Queryable;
}

const mockProvider = {
  model: "test-model",
  embedQuery: vi.fn(() => Promise.resolve([[1, 0, 0]])),
} as unknown as EmbeddingProvider;

const mockGuard: CostGuard = vi.fn(() => Promise.resolve(false));
const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

const now = new Date("2026-09-27T12:00:00Z");

function createMockLlm() {
  return {
    complete: vi.fn(),
  } as unknown as LlmClient;
}

function baseOptions(
  overrides: Partial<SelectionOptions> & { db?: Queryable; llm?: LlmClient } = {},
): SelectionOptions {
  return {
    db: overrides.db ?? createMockDb(),
    context: mockContext,
    provider: mockProvider,
    llm: overrides.llm ?? createMockLlm(),
    guard: mockGuard,
    logger: mockLogger,
    now,
    ...overrides,
  };
}

describe("priorityOf", () => {
  const baseCandidate = {
    id: "item-1",
    title: "Test",
    content: "Content",
    kind: "article",
    publishedAt: now,
    fetchedAt: now,
    sourceTargetId: null as string | null,
  };

  it("returns 0 for diff with target", () => {
    expect(priorityOf({ ...baseCandidate, kind: "diff", sourceTargetId: targetId })).toBe(0);
  });

  it("returns 0 for job with target", () => {
    expect(priorityOf({ ...baseCandidate, kind: "job", sourceTargetId: targetId })).toBe(0);
  });

  it("returns 1 for release", () => {
    expect(priorityOf({ ...baseCandidate, kind: "release" })).toBe(1);
  });

  it("returns 1 for article with target", () => {
    expect(priorityOf({ ...baseCandidate, kind: "article", sourceTargetId: targetId })).toBe(1);
  });

  it("returns 2 for article without target", () => {
    expect(priorityOf({ ...baseCandidate, kind: "article" })).toBe(2);
  });

  it("returns 2 for google_news without target", () => {
    expect(priorityOf({ ...baseCandidate, kind: "google_news" })).toBe(2);
  });

  it("returns 2 for reddit without target", () => {
    expect(priorityOf({ ...baseCandidate, kind: "reddit" })).toBe(2);
  });

  it("returns 1 for diff without target", () => {
    expect(priorityOf({ ...baseCandidate, kind: "diff" })).toBe(1);
  });

  it("returns 1 for job without target", () => {
    expect(priorityOf({ ...baseCandidate, kind: "job" })).toBe(1);
  });
});

describe("selectForProfile — priority and cosine rules", () => {
  it("diff with target skips cosine and gets priority 0", async () => {
    const diffCandidate = {
      id: "diff-1",
      title: "Price change",
      content: "Price increased from $10 to $15",
      kind: "diff",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: targetId,
    };

    const articleCandidate = {
      id: "article-1",
      title: "Industry news",
      content: "General industry news article",
      kind: "article",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: null,
    };

    const dbWithCandidates = createMockDb([diffCandidate, articleCandidate]);

    const testLlm = createMockLlm();
    testLlm.complete = vi
      .fn()
      .mockResolvedValueOnce({
        value: { material: true, kind: "price", summary: "Price increased", urgent: true },
      })
      .mockResolvedValueOnce({
        value: { relevant: false, targetId: null, reason: "Not relevant" },
      });

    const result = await selectForProfile(baseOptions({ db: dbWithCandidates, llm: testLlm }));

    const diffDecision = result.decisions.find((d) => d.rawItemId === "diff-1");
    const articleDecision = result.decisions.find((d) => d.rawItemId === "article-1");

    expect(diffDecision).toBeDefined();
    expect(diffDecision?.priority).toBe(0);
    expect(diffDecision?.outcome).toBe("event");

    expect(articleDecision).toBeDefined();
    expect(articleDecision?.priority).toBe(2);
  });

  it("diff with target and low cosine reaches model, article with same cosine rejected below_cosine", async () => {
    const diffCandidate = {
      id: "diff-1",
      title: "Price change",
      content: "Price increased",
      kind: "diff",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: targetId,
    };

    const articleCandidate = {
      id: "article-1",
      title: "Industry news",
      content: "General news",
      kind: "article",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: null,
    };

    const dbWithCandidates = createMockDb([diffCandidate, articleCandidate]);

    const testLlm = createMockLlm();
    testLlm.complete = vi.fn().mockResolvedValueOnce({
      value: { material: true, kind: "price", summary: "Price increased", urgent: true },
    });

    const result = await selectForProfile(baseOptions({ db: dbWithCandidates, llm: testLlm }));

    const diffDecision = result.decisions.find((d) => d.rawItemId === "diff-1");
    const articleDecision = result.decisions.find((d) => d.rawItemId === "article-1");

    expect(diffDecision).toBeDefined();
    expect(diffDecision?.outcome).toBe("event");
    expect(diffDecision?.priority).toBe(0);

    expect(articleDecision).toBeDefined();
    expect(articleDecision?.outcome).toBe("below_cosine");
    expect(articleDecision?.priority).toBe(2);
  });
});

describe("selectForProfile — diff reserve", () => {
  it("priority 0 items pass through diff reserve when main budget exhausted", async () => {
    const candidates: Array<{
      id: string;
      title: string;
      content: string;
      kind: string;
      publishedAt: Date;
      fetchedAt: Date;
      sourceTargetId: string | null;
    }> = Array.from({ length: 50 }, (_, i) => ({
      id: `article-${i}`,
      title: `Article ${i}`,
      content: "General news",
      kind: "article",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: null,
    }));

    candidates.push({
      id: "diff-1",
      title: "Price change",
      content: "Price increased",
      kind: "diff",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: targetId,
    });

    const vectors = new Map<string, number[][]>();
    for (const c of candidates) {
      vectors.set(c.id, [[0.85, 0.1, 0.05]]); // High cosine to pass cutoff
    }

    const dbWithCandidates = createMockDb(candidates, vectors);

    let llmCallIndex = 0;
    const testLlm = createMockLlm();
    testLlm.complete = vi.fn().mockImplementation(() => {
      llmCallIndex += 1;
      // First call is for diff (priority 0), rest are for articles
      if (llmCallIndex === 1) {
        return Promise.resolve({
          value: { material: true, kind: "price", summary: "Price increased", urgent: true },
        });
      }
      return Promise.resolve({
        value: { relevant: true, targetId, reason: "Relevant" },
      });
    });

    const result = await selectForProfile(baseOptions({ db: dbWithCandidates, llm: testLlm }));

    const events = result.decisions.filter((d) => d.outcome === "event");
    const diffEvent = events.find((d) => d.rawItemId === "diff-1");

    expect(diffEvent).toBeDefined();
    expect(diffEvent?.priority).toBe(0);
  });
});

describe("selectForProfile — urgent rule in code", () => {
  it("urgent: true + kind: copy → not urgent", async () => {
    const candidate = {
      id: "diff-1",
      title: "Copy change",
      content: "Minor copy update",
      kind: "diff",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: targetId,
    };

    const dbWithCandidates = createMockDb([candidate]);

    const testLlm = createMockLlm();
    testLlm.complete = vi.fn().mockResolvedValueOnce({
      value: { material: true, kind: "copy", summary: "Copy changed", urgent: true },
    });

    const result = await selectForProfile(baseOptions({ db: dbWithCandidates, llm: testLlm }));

    const decision = result.decisions.find((d) => d.rawItemId === "diff-1");
    expect(decision?.outcome).toBe("event");
  });

  it("urgent: true + kind: price → urgent", async () => {
    const candidate = {
      id: "diff-1",
      title: "Price change",
      content: "Price increased",
      kind: "diff",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: targetId,
    };

    const dbWithCandidates = createMockDb([candidate]);

    const testLlm = createMockLlm();
    testLlm.complete = vi.fn().mockResolvedValueOnce({
      value: { material: true, kind: "price", summary: "Price increased", urgent: true },
    });

    const result = await selectForProfile(baseOptions({ db: dbWithCandidates, llm: testLlm }));

    const decision = result.decisions.find((d) => d.rawItemId === "diff-1");
    expect(decision?.outcome).toBe("event");
  });

  it("urgent: true + kind: price but target paused → not urgent", async () => {
    const contextWithPausedTarget: ProfileContext = {
      ...mockContext,
      targets: [
        { id: targetId, kind: "competitor", name: "Competitor", reason: null, aliases: [] },
      ],
    };

    const candidate = {
      id: "diff-1",
      title: "Price change",
      content: "Price increased",
      kind: "diff",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: targetId,
    };

    const dbWithCandidates = createMockDb([candidate]);

    const testLlm = createMockLlm();
    testLlm.complete = vi.fn().mockResolvedValueOnce({
      value: { material: true, kind: "price", summary: "Price increased", urgent: true },
    });

    const result = await selectForProfile(
      baseOptions({ db: dbWithCandidates, context: contextWithPausedTarget, llm: testLlm }),
    );

    const decision = result.decisions.find((d) => d.rawItemId === "diff-1");
    expect(decision?.outcome).toBe("event");
  });

  it("articles (not diff/job) are never urgent even if model says so", async () => {
    const candidate = {
      id: "article-1",
      title: "Breaking news",
      content: "Major announcement",
      kind: "article",
      publishedAt: now,
      fetchedAt: now,
      sourceTargetId: targetId,
    };

    const vectors = new Map<string, number[][]>();
    vectors.set("article-1", [[0.9, 0.1, 0]]); // High cosine to pass cutoff

    const dbWithCandidates = createMockDb([candidate], vectors);

    const testLlm = createMockLlm();
    testLlm.complete = vi.fn().mockResolvedValueOnce({
      value: { relevant: true, targetId, reason: "Relevant" },
    });

    const result = await selectForProfile(baseOptions({ db: dbWithCandidates, llm: testLlm }));

    const decision = result.decisions.find((d) => d.rawItemId === "article-1");
    expect(decision?.outcome).toBe("event");
  });
});

describe("selectForProfile — sorting by priority then cosine", () => {
  it("priority 0 items come before priority 1, then priority 2", async () => {
    const candidates = [
      {
        id: "article-1",
        title: "News",
        content: "News",
        kind: "article",
        publishedAt: now,
        fetchedAt: now,
        sourceTargetId: null,
      },
      {
        id: "release-1",
        title: "Release",
        content: "Release",
        kind: "release",
        publishedAt: now,
        fetchedAt: now,
        sourceTargetId: targetId,
      },
      {
        id: "diff-1",
        title: "Diff",
        content: "Diff",
        kind: "diff",
        publishedAt: now,
        fetchedAt: now,
        sourceTargetId: targetId,
      },
    ];

    const vectors = new Map<string, number[][]>();
    vectors.set("article-1", [[0.7, 0.2, 0.1]]); // Lowest cosine
    vectors.set("release-1", [[0.85, 0.1, 0.05]]); // Medium cosine
    vectors.set("diff-1", [[0.5, 0.1, 0.1]]); // Lowest but priority 0 skips cosine

    const dbWithCandidates = createMockDb(candidates, vectors);

    const testLlm = createMockLlm();
    testLlm.complete = vi
      .fn()
      .mockResolvedValueOnce({
        value: { material: true, kind: "price", summary: "Diff", urgent: true },
      })
      .mockResolvedValueOnce({ value: { relevant: true, targetId, reason: "Release" } })
      .mockResolvedValueOnce({ value: { relevant: true, targetId, reason: "Article" } });

    const result = await selectForProfile(baseOptions({ db: dbWithCandidates, llm: testLlm }));

    const order = result.decisions.filter((d) => d.outcome === "event").map((d) => d.rawItemId);
    expect(order).toEqual(["diff-1", "release-1", "article-1"]);
  });
});
