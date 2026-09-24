/**
 * Tests for page-diff connector.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http/safe-fetch.js", () => ({ safeFetch: vi.fn() }));

import { safeFetch } from "../http/safe-fetch.js";
import { diffText, normalizeText, pollPageDiff } from "./page-diff.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function servePage(name: string): void {
  vi.mocked(safeFetch).mockResolvedValue({
    status: 200,
    isUnchanged: false,
    body: readFileSync(join(fixtures, name)),
    finalUrl: "https://example.com/pricing",
    contentType: "text/html",
    etag: undefined,
    lastModifiedAt: undefined,
  });
}

describe("page-diff", () => {
  describe("normalizeText", () => {
    it("removes noise lines (dates, copyright symbols)", () => {
      const text = `Line 1
01/01/2024
Line 2
© 2024
Line 3`;

      const normalized = normalizeText(text);

      expect(normalized).not.toContain("01/01/2024");
      expect(normalized).not.toContain("© 2024");
      expect(normalized).toContain("Line 1");
      expect(normalized).toContain("Line 2");
      expect(normalized).toContain("Line 3");
    });

    it("keeps a Russian line, which is not noise", () => {
      const text = "Тариф Про — 990 ₽ в месяц";

      const normalized = normalizeText(text);

      expect(normalized).toBe(text);
    });

    it("treats a copyright line with a changed year as noise", () => {
      const normalized = normalizeText("Pricing\nCopyright 2025");

      expect(normalized).toBe("Pricing");
    });

    it("removes short lines", () => {
      const text = `Line 1
a
Line 2`;

      const normalized = normalizeText(text);

      expect(normalized).not.toContain("a");
      expect(normalized).toContain("Line 1");
      expect(normalized).toContain("Line 2");
    });

    it("preserves paragraph breaks", () => {
      const text = `Paragraph 1

Paragraph 2`;

      const normalized = normalizeText(text);

      expect(normalized).toContain("Paragraph 1");
      expect(normalized).toContain("Paragraph 2");
    });
  });

  describe("diffText", () => {
    it("detects added and removed lines", () => {
      const oldText = "Line 1\nLine 2\nLine 3";
      const newText = "Line 1\nLine 2 modified\nLine 3\nLine 4 added";

      const { added, removed } = diffText(oldText, newText);

      expect(added).toContain("Line 4 added");
      expect(removed).toContain("Line 2");
    });

    it("handles unchanged text", () => {
      const text = "Line 1\nLine 2";
      const { added, removed } = diffText(text, text);

      expect(added).toBe("");
      expect(removed).toBe("");
    });

    it("handles all new text", () => {
      const { added, removed } = diffText("", "New line 1\nNew line 2");

      expect(added).toContain("New line 1");
      expect(added).toContain("New line 2");
      expect(removed).toBe("");
    });

    it("handles all removed text", () => {
      const { added, removed } = diffText("Old line 1\nOld line 2", "");

      expect(added).toBe("");
      expect(removed).toContain("Old line 1");
      expect(removed).toContain("Old line 2");
    });

    it("limits line length to 2000 chars", () => {
      const longLine = "x".repeat(2500);
      const oldText = "Line 1";
      const newText = `Line 1\n${longLine}`;

      const { added } = diffText(oldText, newText);

      const addedLines = added.split("\n");
      const longLineResult = addedLines.find((line) => line.length > 2000);
      expect(longLineResult).toBeUndefined();
    });
  });

  describe("pollPageDiff", () => {
    beforeEach(() => {
      vi.mocked(safeFetch).mockReset();
    });

    it("returns a baseline with nothing added or removed on the first poll", async () => {
      servePage("baseline.html");

      const result = await pollPageDiff({ url: "https://example.com/pricing", userAgent: "test" });

      expect(result).toMatchObject({ isUnchanged: false, added: "", removed: "" });
    });

    it("reports the added paragraph and ignores the copyright year", async () => {
      servePage("baseline.html");
      const baseline = await pollPageDiff({
        url: "https://example.com/pricing",
        userAgent: "test",
      });
      if (baseline.isUnchanged) throw new Error("baseline should not be unchanged");
      servePage("modified.html");

      const result = await pollPageDiff({
        url: "https://example.com/pricing",
        userAgent: "test",
        previousHash: baseline.contentHash,
        previousText: baseline.extractedText,
      });

      expect(result).toMatchObject({
        isUnchanged: false,
        added: "This is a new paragraph added to the page.",
        removed: "",
      });
    });

    it("reports unchanged when the page is the same", async () => {
      servePage("baseline.html");
      const baseline = await pollPageDiff({
        url: "https://example.com/pricing",
        userAgent: "test",
      });
      if (baseline.isUnchanged) throw new Error("baseline should not be unchanged");

      const result = await pollPageDiff({
        url: "https://example.com/pricing",
        userAgent: "test",
        previousHash: baseline.contentHash,
        previousText: baseline.extractedText,
      });

      expect(result.isUnchanged).toBe(true);
    });
  });
});
