/**
 * Chunking logic for raw items.
 *
 * Splits text into overlapping chunks of ~300-500 tokens (estimated as chars / 4).
 * For diff items, only chunks the added text.
 * Returns chunks with character offsets into the original content.
 */

export interface ChunkInput {
  readonly content: string;
  readonly kind: "article" | "diff" | "job" | "release";
  readonly addedText?: string | null;
  readonly removedText?: string | null;
}

export interface Chunk {
  readonly content: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

const TARGET_CHUNK_SIZE = 400; // tokens
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = TARGET_CHUNK_SIZE * CHARS_PER_TOKEN; // ~1600 chars
const OVERLAP_CHARS = 50 * CHARS_PER_TOKEN; // 200 chars overlap
const MIN_CHUNK_CHARS = 100;

/**
 * Split content into paragraphs by double newline.
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split a single paragraph into chunks if it's too long.
 */
function splitLongParagraph(
  paragraph: string,
  targetChars: number,
  overlapChars: number,
): string[] {
  if (paragraph.length <= targetChars) return [paragraph];

  const chunks: string[] = [];
  let start = 0;

  while (start < paragraph.length) {
    const end = Math.min(start + targetChars, paragraph.length);
    chunks.push(paragraph.slice(start, end));
    if (end === paragraph.length) break;
    start = end - overlapChars;
  }

  return chunks;
}

/**
 * Chunk a text into overlapping chunks.
 */
export function chunkText(text: string): Chunk[] {
  if (text.trim().length === 0) return [];

  const paragraphs = splitParagraphs(text);
  const chunks: Chunk[] = [];
  let currentOffset = 0;

  for (const paragraph of paragraphs) {
    const paraStart = text.indexOf(paragraph, currentOffset);
    if (paraStart === -1) continue;

    const paraChunks = splitLongParagraph(paragraph, TARGET_CHARS, OVERLAP_CHARS);

    for (const chunk of paraChunks) {
      const chunkStart = text.indexOf(chunk, currentOffset);
      if (chunkStart === -1) continue;

      const chunkEnd = chunkStart + chunk.length;

      if (chunk.trim().length >= MIN_CHUNK_CHARS) {
        chunks.push({
          content: chunk,
          startOffset: chunkStart,
          endOffset: chunkEnd,
        });
      }

      currentOffset = chunkEnd;
    }

    currentOffset = paraStart + paragraph.length;
  }

  return chunks;
}

/**
 * Chunk a raw item based on its kind.
 * For diff items, only chunks the added text.
 */
export function chunkRawItem(input: ChunkInput): Chunk[] {
  const { content, kind, addedText } = input;

  if (kind === "diff") {
    // For diffs, only chunk the added text
    const textToChunk = addedText ?? "";
    if (textToChunk.trim().length === 0) return [];

    const chunks = chunkText(textToChunk);
    // Adjust offsets to be relative to the full content
    const addedStart = content.indexOf(addedText ?? "");
    if (addedStart === -1) return chunks; // fallback

    return chunks.map((chunk) => ({
      ...chunk,
      startOffset: chunk.startOffset + addedStart,
      endOffset: chunk.endOffset + addedStart,
    }));
  }

  // For other kinds, chunk the full content
  return chunkText(content);
}
