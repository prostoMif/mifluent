/**
 * Turning the bytes of a feed into text.
 *
 * This has its own file because feeds lie about their encoding, and they lie in
 * three different places at once: the HTTP `Content-Type` header, the XML
 * declaration at the top of the document, and reality. A Russian or Polish blog
 * running old software still serves windows-1251 or iso-8859-2, and reading it
 * as UTF-8 produces a page of question marks that then gets embedded, indexed
 * and put in front of somebody as a summary.
 *
 * The order below — declaration first, header second, UTF-8 last — is the one
 * that gets it right most often. The XML declaration is written by whatever
 * produced the document; the header is written by the web server, which
 * frequently has a default nobody has looked at since installation.
 */

/** Enough of the start to find a declaration in, without decoding the lot. */
const DECLARATION_WINDOW_BYTES = 1024;

const DECLARATION_PATTERN = /encoding\s*=\s*["']([\w-]+)["']/i;

const CHARSET_PATTERN = /charset\s*=\s*["']?([\w-]+)/i;

const DEFAULT_ENCODING = "utf-8";

export interface DecodeOptions {
  readonly body: Buffer;
  /** The HTTP header, if there was one. */
  readonly contentType?: string | undefined;
}

export function decodeFeed(options: DecodeOptions): string {
  const declared = readDeclaredEncoding(options.body) ?? readHeaderCharset(options.contentType);
  const text = decodeWith(options.body, declared ?? DEFAULT_ENCODING);

  return stripByteOrderMark(text);
}

/**
 * Read the encoding out of the XML declaration.
 *
 * Decoded as Latin-1 rather than UTF-8, because at this point the encoding is
 * exactly what is not yet known. Every encoding a feed might plausibly use
 * agrees with ASCII for the characters a declaration is made of, so any of them
 * produces a readable declaration; the goal is only to find the name.
 */
function readDeclaredEncoding(body: Buffer): string | undefined {
  const window = body.subarray(0, DECLARATION_WINDOW_BYTES).toString("latin1");
  const match = DECLARATION_PATTERN.exec(window);

  return match?.[1]?.toLowerCase();
}

function readHeaderCharset(contentType: string | undefined): string | undefined {
  if (contentType === undefined) {
    return undefined;
  }

  const match = CHARSET_PATTERN.exec(contentType);
  return match?.[1]?.toLowerCase();
}

/**
 * Decode, falling back rather than failing.
 *
 * `TextDecoder` refuses an encoding name it does not know, and a feed
 * announcing something exotic or misspelled is a feed we would rather read
 * imperfectly than not at all. `fatal: false` likewise turns an invalid byte
 * into a replacement character instead of losing the whole document over one
 * bad character in one item.
 */
function decodeWith(body: Buffer, encoding: string): string {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(body);
  } catch {
    return new TextDecoder(DEFAULT_ENCODING, { fatal: false }).decode(body);
  }
}

/**
 * A byte order mark at the start of the text is not content.
 *
 * Left in place it becomes the first character of the document, and the XML
 * parser then reports that the document does not begin with an element.
 */
function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
