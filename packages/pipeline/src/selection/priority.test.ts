import { describe, expect, it } from "vitest";
import { DIFF_RESERVE_PER_DAY, type Priority, priorityOf } from "./priority.js";
import type { Candidate } from "./select.js";

const now = new Date();
const targetId = "target-1";

function baseCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "item-1",
    title: "Test",
    content: "Content",
    kind: "article",
    publishedAt: now,
    fetchedAt: now,
    sourceTargetId: null,
    ...overrides,
  };
}

describe("priorityOf", () => {
  it("returns 0 for diff with target", () => {
    const result = priorityOf(baseCandidate({ kind: "diff", sourceTargetId: targetId }));
    expect(result).toBe(0);
  });

  it("returns 0 for job with target", () => {
    const result = priorityOf(baseCandidate({ kind: "job", sourceTargetId: targetId }));
    expect(result).toBe(0);
  });

  it("returns 1 for release", () => {
    const result = priorityOf(baseCandidate({ kind: "release" }));
    expect(result).toBe(1);
  });

  it("returns 1 for article with target", () => {
    const result = priorityOf(baseCandidate({ kind: "article", sourceTargetId: targetId }));
    expect(result).toBe(1);
  });

  it("returns 1 for google_news with target", () => {
    const result = priorityOf(baseCandidate({ kind: "google_news", sourceTargetId: targetId }));
    expect(result).toBe(1);
  });

  it("returns 1 for reddit with target", () => {
    const result = priorityOf(baseCandidate({ kind: "reddit", sourceTargetId: targetId }));
    expect(result).toBe(1);
  });

  it("returns 2 for article without target", () => {
    const result = priorityOf(baseCandidate({ kind: "article" }));
    expect(result).toBe(2);
  });

  it("returns 2 for google_news without target", () => {
    const result = priorityOf(baseCandidate({ kind: "google_news" }));
    expect(result).toBe(2);
  });

  it("returns 2 for reddit without target", () => {
    const result = priorityOf(baseCandidate({ kind: "reddit" }));
    expect(result).toBe(2);
  });

  it("returns 1 for diff without target", () => {
    const result = priorityOf(baseCandidate({ kind: "diff" }));
    expect(result).toBe(1);
  });

  it("returns 1 for job without target", () => {
    const result = priorityOf(baseCandidate({ kind: "job" }));
    expect(result).toBe(1);
  });

  it("DIFF_RESERVE_PER_DAY is 10", () => {
    expect(DIFF_RESERVE_PER_DAY).toBe(10);
  });

  it("Priority type only allows 0, 1, 2", () => {
    const p0: Priority = 0;
    const p1: Priority = 1;
    const p2: Priority = 2;
    expect([p0, p1, p2]).toEqual([0, 1, 2]);
  });
});
