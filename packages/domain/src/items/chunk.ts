/**
 * Cutting material into pieces small enough to embed.
 *
 * Paragraphs are packed together until a chunk reaches roughly 400 tokens,
 * rather than one chunk per paragraph: a news item is often twenty short
 * paragraphs, and twenty vectors of one sentence each match a profile worse
 * than four vectors of five sentences. A paragraph too long on its own is cut
 * into windows.
 *
 * Consecutive chunks overlap by about 50 tokens, so a sentence that straddles
 * a boundary is whole in at least one of them.
 *
 * Offsets are into the original text, and `text.slice(start, end)` is exactly
 * the chunk — quote verification later relies on being able to go from a chunk
 * back to the material it came from.
 */

export interface ChunkInput {
  readonly content: string;
  readonly kind: "article" | "diff" | "job" | "release";
  /** For diffs: the added text, which appears verbatim inside `content`. */
  readonly addedText?: string | null;
}

export interface Chunk {
  readonly content: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * Four characters per token is the usual rule of thumb for English and close
 * enough for Russian; exact counts would need the tokenizer, and nothing here
 * depends on hitting the size exactly.
 */
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = 400 * CHARS_PER_TOKEN;
const OVERLAP_CHARS = 50 * CHARS_PER_TOKEN;

const PARAGRAPH_BREAK = /\n[^\S\n]*\n\s*/g;

export function chunkText(text: string): Chunk[] {
  const chunks: Span[] = [];
  let current: Span | undefined;

  for (const paragraph of findParagraphs(text)) {
    if (paragraph.end - paragraph.start > TARGET_CHARS) {
      if (current !== undefined) chunks.push(current);
      current = undefined;
      chunks.push(...splitIntoWindows(text, paragraph));
      continue;
    }

    if (current === undefined) {
      current = paragraph;
      continue;
    }

    if (paragraph.end - current.start <= TARGET_CHARS) {
      current = { start: current.start, end: paragraph.end };
      continue;
    }

    chunks.push(current);
    current = { start: overlapStart(text, current), end: paragraph.end };
  }

  if (current !== undefined) chunks.push(current);

  return chunks.map((span) => ({
    content: text.slice(span.start, span.end),
    startOffset: span.start,
    endOffset: span.end,
  }));
}

/**
 * Chunks for one raw item.
 *
 * A diff is embedded by what was added only. Removed text describes the page
 * as it no longer is, and matching a profile against it would report a
 * competitor dropping a feature as if they had launched it.
 */
export function chunkRawItem(input: ChunkInput): Chunk[] {
  if (input.kind !== "diff") {
    return chunkText(input.content);
  }

  const added = input.addedText ?? "";
  const addedStart = added.trim() === "" ? -1 : input.content.indexOf(added);

  if (addedStart === -1) {
    return [];
  }

  return chunkText(added).map((chunk) => ({
    content: chunk.content,
    startOffset: chunk.startOffset + addedStart,
    endOffset: chunk.endOffset + addedStart,
  }));
}

/** Spans of non-blank paragraphs, trimmed, in order. */
function findParagraphs(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;

  for (const breakMatch of text.matchAll(PARAGRAPH_BREAK)) {
    pushTrimmed(text, { start, end: breakMatch.index }, spans);
    start = breakMatch.index + breakMatch[0].length;
  }

  pushTrimmed(text, { start, end: text.length }, spans);
  return spans;
}

function pushTrimmed(text: string, span: Span, into: Span[]): void {
  let { start, end } = span;
  while (start < end && /\s/.test(text.charAt(start))) start += 1;
  while (end > start && /\s/.test(text.charAt(end - 1))) end -= 1;
  if (end > start) into.push({ start, end });
}

function splitIntoWindows(text: string, paragraph: Span): Span[] {
  const windows: Span[] = [];
  let start = paragraph.start;

  for (;;) {
    const end = wordBoundaryBefore(text, Math.min(start + TARGET_CHARS, paragraph.end), start);
    windows.push({ start, end });
    if (end >= paragraph.end) return windows;
    start = wordBoundaryAfter(text, Math.max(end - OVERLAP_CHARS, start + 1), end);
  }
}

/** Where the next chunk starts so that it repeats the tail of the previous one. */
function overlapStart(text: string, previous: Span): number {
  const candidate = Math.max(previous.end - OVERLAP_CHARS, previous.start);
  return wordBoundaryAfter(text, candidate, previous.end);
}

/** Pull `position` back to just after whitespace, so a window does not end mid-word. */
function wordBoundaryBefore(text: string, position: number, floor: number): number {
  if (position >= text.length || /\s/.test(text.charAt(position))) return position;
  for (let index = position; index > floor; index -= 1) {
    if (/\s/.test(text.charAt(index - 1))) return index - 1;
  }
  return position;
}

/** Push `position` forward to the start of a word, so a chunk does not begin mid-word. */
function wordBoundaryAfter(text: string, position: number, ceiling: number): number {
  for (let index = position; index < ceiling; index += 1) {
    const isWordStart =
      !/\s/.test(text.charAt(index)) && (index === 0 || /\s/.test(text.charAt(index - 1)));
    if (isWordStart) return index;
  }
  return position;
}
