/**
 * Verbatim quote verification.
 *
 * Every claim in a digest carries a quote, and the quote must exist in the
 * source. The model returns only the quote text; this file finds it, and
 * computes the offsets itself — AGENTS.md: the model is never asked for
 * offsets, and a quote that is not found is dropped, never matched fuzzily.
 *
 * The only tolerance is for differences that are typography rather than
 * wording: runs of whitespace, curly versus straight quotes, the several
 * dashes, a non-breaking space, an ellipsis character. A model copying text
 * routinely normalises those, and rejecting a quote over `’` versus `'` would
 * drop true facts without making anything safer. Letters, digits and word
 * order must match exactly.
 */

export interface QuoteMatch {
  /** Offsets into the original material. */
  readonly startOffset: number;
  readonly endOffset: number;
  /** The material's own text at those offsets — what is stored and shown. */
  readonly text: string;
}

interface NormalisedText {
  readonly text: string;
  /** For each character of `text`, the index in the original it came from. */
  readonly origin: readonly number[];
}

/**
 * Shorter than this, a "quote" proves nothing: "the price" appears in every
 * pricing page ever written.
 */
export const MIN_QUOTE_LENGTH = 10;

const DOUBLE_QUOTES = new Set(["“", "”", "„", "«", "»", "″"]);
const SINGLE_QUOTES = new Set(["‘", "’", "‚", "′"]);
const DASHES = new Set(["‐", "‑", "‒", "–", "—", "―", "−"]);

export function findQuote(material: string, quote: string): QuoteMatch | null {
  const needle = normalise(quote).text;
  if (needle.length < MIN_QUOTE_LENGTH) return null;

  const haystack = normalise(material);
  const at = haystack.text.indexOf(needle);
  if (at === -1) return null;

  const startOffset = haystack.origin[at];
  const lastOrigin = haystack.origin[at + needle.length - 1];
  if (startOffset === undefined || lastOrigin === undefined) return null;

  const endOffset = lastOrigin + 1;
  return { startOffset, endOffset, text: material.slice(startOffset, endOffset) };
}

/** Exported for tests. */
export function normalise(text: string): NormalisedText {
  const characters: string[] = [];
  const origin: number[] = [];
  let isInWhitespace = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);

    if (/\s/.test(character)) {
      // A run of whitespace becomes one space, attributed to its first
      // character; leading whitespace is dropped entirely.
      if (!isInWhitespace && characters.length > 0) {
        characters.push(" ");
        origin.push(index);
      }
      isInWhitespace = true;
      continue;
    }

    isInWhitespace = false;
    for (const replacement of replace(character)) {
      characters.push(replacement);
      origin.push(index);
    }
  }

  if (characters.at(-1) === " ") {
    characters.pop();
    origin.pop();
  }

  return { text: characters.join(""), origin };
}

function replace(character: string): string {
  if (DOUBLE_QUOTES.has(character)) return '"';
  if (SINGLE_QUOTES.has(character)) return "'";
  if (DASHES.has(character)) return "-";
  if (character === "…") return "...";
  return character;
}
