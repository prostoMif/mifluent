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

const NOISE_PATTERNS = [
  /^\s*$/,
  /^[\s\d\W]*$/,
  /^[\s\d]*\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}[\s\d]*$/,
  /^[\s\d]*\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}[\s\d]*$/,
  /^[©®™]/i,
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

export function diffText(oldText: string, newText: string): { added: string; removed: string } {
  const diff = diffLines(oldText, newText);

  let added = "";
  let removed = "";

  for (const part of diff) {
    if (part.added) {
      added += part.value;
    } else if (part.removed) {
      removed += part.value;
    }
  }

  // Limit each line to 2000 chars as per spec
  const truncate = (text: string): string =>
    text
      .split("\n")
      .map((line) => (line.length > 2000 ? line.slice(0, 2000) : line))
      .join("\n");

  return {
    added: truncate(added),
    removed: truncate(removed),
  };
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
