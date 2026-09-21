/**
 * Decoding the character references a feed is allowed to contain.
 *
 * The XML parser is configured with entity processing switched off, and this
 * file is why that is safe rather than merely strict.
 *
 * Entity processing is the feature behind the "billion laughs" attack: a
 * document declares an entity that expands into ten copies of another, which
 * expands into ten copies of another, and a few kilobytes of XML become
 * gigabytes of memory. It is also the feature that reads external files from
 * disk. Neither is anything a feed needs.
 *
 * So the parser does none of it, and the five references that are part of XML
 * itself — plus numeric character references — are decoded here instead. An
 * allowlist of five is a thing that can be read and checked; a general entity
 * engine is not.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Above this is not a character, and `String.fromCodePoint` throws on it. */
const MAXIMUM_CODE_POINT = 0x10ffff;

const REFERENCE_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

export function decodeXmlEntities(text: string): string {
  if (!text.includes("&")) {
    return text;
  }

  return text.replace(REFERENCE_PATTERN, (whole, reference: string) => {
    const decoded = decodeReference(reference);

    // Anything unrecognised is left exactly as it was found. A feed containing
    // "&nbsp;" is better read with those six characters visible than with them
    // silently deleted, and guessing at an entity nobody declared is how a
    // decoder grows into the thing this file exists to avoid.
    return decoded ?? whole;
  });
}

function decodeReference(reference: string): string | undefined {
  const lower = reference.toLowerCase();

  if (lower.startsWith("#x")) {
    return fromCodePoint(Number.parseInt(lower.slice(2), 16));
  }

  if (lower.startsWith("#")) {
    return fromCodePoint(Number.parseInt(lower.slice(1), 10));
  }

  return NAMED_ENTITIES[lower];
}

function fromCodePoint(code: number): string | undefined {
  if (!Number.isInteger(code) || code < 0 || code > MAXIMUM_CODE_POINT) {
    return undefined;
  }

  // Surrogate halves on their own are not characters, and pasting one into a
  // string produces text that cannot be stored or compared reliably.
  if (code >= 0xd800 && code <= 0xdfff) {
    return undefined;
  }

  return String.fromCodePoint(code);
}
