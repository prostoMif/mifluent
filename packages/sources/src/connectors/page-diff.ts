/**
 * Page diff connector: fetches a page, extracts text, and computes diffs.
 *
 * Reuses safeFetch for the HTTP layer and htmlToText for extraction.
 * Computes line-based diffs with noise filtering.
 */

import { createHash } from "node:crypto";
import { diffLines } from "diff";
import { htmlToText } from "../feeds/html-text.js";
import { type SafeFetchOptions, safeFetch } from "../http/safe-fetch.js";

export interface PageDiffOptions {
  readonly url: string;
  readonly userAgent: string;
  readonly previousHash?: string | undefined;
  readonly previousText?: string | undefined;
}

export interface PageDiffResultUnchanged {
  readonly isUnchanged: true;
  readonly contentHash: string;
}

export interface PageDiffResultChanged {
  readonly isUnchanged: false;
  readonly contentHash: string;
  readonly extractedText: string;
  readonly added: string;
  readonly removed: string;
}

export type PageDiffResult = PageDiffResultUnchanged | PageDiffResultChanged;

/**
 * Lines that change on every load without meaning anything: dates, counters,
 * copyright years. `\p{P}` and `\p{S}` rather than `\W`, because `\W` treats
 * every non-Latin letter as noise — a Russian pricing page would diff as empty.
 */
const NOISE_PATTERNS = [
  /^\s*$/,
  /^[\s\d\p{P}\p{S}]*$/u,
  /^[\s\d]*\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}[\s\d]*$/,
  /^[\s\d]*\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}[\s\d]*$/,
  /^(©|®|™|\(c\)|copyright\b)/iu,
];

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function normalizeText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !isNoiseLine(line))
    .join("\n")
    .trim();
}

function computeHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Longest a single added or removed line may be; a page of minified text is one line. */
const MAX_LINE_LENGTH = 2_000;

export function diffText(oldText: string, newText: string): { added: string; removed: string } {
  // Both sides end in a newline, or `diffLines` reports the last line as
  // changed merely because one of them gained a line after it.
  const parts = diffLines(withTrailingNewline(oldText), withTrailingNewline(newText));

  const added: string[] = [];
  const removed: string[] = [];

  for (const part of parts) {
    const target = part.added ? added : part.removed ? removed : undefined;
    if (target === undefined) continue;
    for (const line of part.value.split("\n")) {
      if (line !== "") target.push(line.slice(0, MAX_LINE_LENGTH));
    }
  }

  return { added: added.join("\n"), removed: removed.join("\n") };
}

function withTrailingNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

export async function pollPageDiff(options: PageDiffOptions): Promise<PageDiffResult> {
  const { url, userAgent, previousHash, previousText } = options;

  // Fetch the page
  const fetchOptions: SafeFetchOptions = {
    url,
    userAgent,
    maxBytes: 5 * 1024 * 1024, // 5 MB
  };

  const result = await safeFetch(fetchOptions);

  if (result.isUnchanged) {
    // 304 - content unchanged
    return {
      isUnchanged: true,
      contentHash: previousHash ?? "",
    };
  }

  // Extract text from HTML
  const html = result.body.toString("utf-8");
  const extractedText = htmlToText(html);
  const normalizedText = normalizeText(extractedText);
  const contentHash = computeHash(normalizedText);

  // If hash matches previous, no change
  if (previousHash && contentHash === previousHash) {
    return {
      isUnchanged: true,
      contentHash,
    };
  }

  // First poll (baseline) - no previous version to compare
  if (!previousText) {
    return {
      isUnchanged: false,
      contentHash,
      extractedText: normalizedText,
      added: "",
      removed: "",
    };
  }

  // Compute diff
  const { added, removed } = diffText(previousText, normalizedText);

  // If no meaningful change (only noise), treat as unchanged
  if (added.trim() === "" && removed.trim() === "") {
    return {
      isUnchanged: true,
      contentHash,
    };
  }

  return {
    isUnchanged: false,
    contentHash,
    extractedText: normalizedText,
    added,
    removed,
  };
}
