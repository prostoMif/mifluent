/**
 * Reading RSS, RDF and Atom into one shape.
 *
 * Three formats, none of them followed closely by the software that produces
 * them. The approach here, and the reason it is not stricter:
 *
 * **Never fail a whole feed over one bad item.** An item with no title, no
 * date and no link is dropped; the other forty are kept. A parser that refuses
 * the document is a source that silently stops working, and the person watching
 * it sees a quiet week rather than a broken feed. That distinction is the one
 * this product cannot afford to get wrong.
 *
 * **Prefer the specific over the general.** `content:encoded` over
 * `description`, an alternate link over the first link, `published` over
 * `updated` — in each pair the first is what the publisher meant and the second
 * is what the software filled in.
 *
 * The namespace-stripping deserves a note. Feeds mix vocabularies constantly:
 * Dublin Core for dates, the content module for full text, Atom links inside
 * RSS. Handling prefixes properly would mean a namespace-aware reader for a
 * payoff of nothing, since the element names do not collide in practice. So
 * prefixes are dropped and `dc:date` is read as `date`.
 */

import { AppError } from "@mifluent/core";
import { XMLParser } from "fast-xml-parser";
import { parseFeedDate } from "./dates.js";
import { decodeFeed } from "./decode.js";
import { htmlToText } from "./html-text.js";
import { decodeXmlEntities } from "./xml-entities.js";

export interface FeedItem {
  /** The publisher's own identifier: `guid` in RSS, `id` in Atom. */
  readonly externalId: string | null;
  readonly url: string | null;
  readonly title: string | null;
  /** Short form, where the feed offers one separately from the body. */
  readonly summary: string | null;
  /**
   * Plain text. Feeds carry markup here and the schema stores text, so the
   * conversion happens once, at the edge, rather than in every place that
   * later reads an item.
   */
  readonly content: string | null;
  readonly author: string | null;
  readonly publishedAt: Date | null;
}

export interface ParsedFeed {
  readonly title: string | null;
  /** The site the feed belongs to, as distinct from the feed's own address. */
  readonly siteUrl: string | null;
  readonly items: readonly FeedItem[];
}

export interface ParseFeedOptions {
  readonly body: Buffer;
  readonly contentType?: string | undefined;
  /** Where the feed was fetched from. Relative links are resolved against it. */
  readonly feedUrl: string;
  readonly now?: Date | undefined;
}

/**
 * A ceiling on document complexity.
 *
 * Counting angle brackets is a blunt instrument, and that is the point: it is
 * one pass over a string with no parsing involved, so it cannot itself be the
 * thing that runs out of memory. A feed with more than this many elements is
 * not a feed anybody reads.
 */
const MAXIMUM_ELEMENTS = 200_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // See xml-entities.ts. The parser does no entity work at all; the five
  // references XML actually defines are decoded afterwards, by hand.
  processEntities: false,
  // Keeps prefixed names readable: dc:date becomes date, content:encoded
  // becomes encoded.
  removeNSPrefix: true,
  // Without this a version number like 2.0 becomes a number, and an item id
  // like 0012 loses its leading zeros.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

export function parseFeed(options: ParseFeedOptions): ParsedFeed {
  const text = decodeFeed({ body: options.body, contentType: options.contentType });

  assertReadable(text);

  const document = parseXml(text);
  const atom = asNode(document["feed"]);
  const rss = asNode(asNode(document["rss"])?.["channel"]);
  const rdf = asNode(document["RDF"]);

  if (atom !== undefined) {
    return readAtom(atom, options);
  }

  if (rss !== undefined) {
    return readRss(rss, options);
  }

  if (rdf !== undefined) {
    return readRdf(rdf, options);
  }

  throw new AppError("source_unsupported", "That address does not look like a feed.", {
    feedUrl: options.feedUrl,
  });
}

function assertReadable(text: string): void {
  if (text.trim() === "") {
    throw new AppError("source_unsupported", "That source returned nothing.");
  }

  let elements = 0;
  for (let index = text.indexOf("<"); index !== -1; index = text.indexOf("<", index + 1)) {
    elements += 1;

    if (elements > MAXIMUM_ELEMENTS) {
      throw new AppError("content_too_large", "That feed is too complicated to read.", {
        maximumElements: MAXIMUM_ELEMENTS,
      });
    }
  }
}

function parseXml(text: string): XmlNode {
  try {
    const parsed: unknown = parser.parse(text);
    return asNode(parsed) ?? {};
  } catch {
    // Deliberately catches everything, including the stack overflow a document
    // nested thousands of levels deep produces. A malformed feed must end as a
    // failed poll, never as a dead worker.
    throw new AppError("source_unsupported", "That feed could not be read.");
  }
}

function readAtom(feed: XmlNode, options: ParseFeedOptions): ParsedFeed {
  const entries = asArray(feed["entry"]);

  return {
    title: asText(feed["title"]),
    siteUrl: findAtomLink(feed["link"], options.feedUrl),
    items: entries.map((entry) => readAtomEntry(entry, options)).filter(isUsableItem),
  };
}

function readAtomEntry(entry: XmlNode, options: ParseFeedOptions): FeedItem {
  return {
    externalId: asText(entry["id"]),
    url: findAtomLink(entry["link"], options.feedUrl),
    title: asText(entry["title"]),
    summary: asText(entry["summary"]),
    content: asText(entry["content"]),
    author: asText(asNode(entry["author"])?.["name"]) ?? asText(entry["author"]),
    // `published` is when it appeared; `updated` is when a typo was fixed.
    publishedAt:
      parseFeedDate(asText(entry["published"]), { now: options.now }) ??
      parseFeedDate(asText(entry["updated"]), { now: options.now }),
  };
}

function readRss(channel: XmlNode, options: ParseFeedOptions): ParsedFeed {
  const items = asArray(channel["item"]);

  return {
    title: asText(channel["title"]),
    siteUrl: absolute(asText(channel["link"]), options.feedUrl),
    items: items.map((item) => readRssItem(item, options)).filter(isUsableItem),
  };
}

function readRssItem(item: XmlNode, options: ParseFeedOptions): FeedItem {
  return {
    externalId: asText(item["guid"]),
    url: absolute(asText(item["link"]), options.feedUrl),
    title: asText(item["title"]),
    summary: asText(item["description"]),
    // content:encoded holds the full article where the feed offers one;
    // description is then only the teaser.
    content: asText(item["encoded"]) ?? asText(item["description"]),
    author: asText(item["creator"]) ?? asText(item["author"]),
    publishedAt:
      parseFeedDate(asText(item["pubDate"]), { now: options.now }) ??
      parseFeedDate(asText(item["date"]), { now: options.now }),
  };
}

/**
 * RSS 1.0, which is RDF underneath. Items are siblings of the channel rather
 * than children of it, which is the only structural difference that matters.
 */
function readRdf(root: XmlNode, options: ParseFeedOptions): ParsedFeed {
  const channel = asNode(root["channel"]) ?? {};
  const items = asArray(root["item"]);

  return {
    title: asText(channel["title"]),
    siteUrl: absolute(asText(channel["link"]), options.feedUrl),
    items: items.map((item) => readRssItem(item, options)).filter(isUsableItem),
  };
}

/**
 * An item with neither a title nor a link nor any text is not an item.
 *
 * Dropped quietly rather than reported: feeds routinely carry an empty element
 * at the end, and an error for each one would bury the failures that matter.
 */
function isUsableItem(item: FeedItem): boolean {
  return item.title !== null || item.url !== null || item.content !== null;
}

/**
 * Atom links are a list, each with a `rel`. The one a reader wants is
 * `alternate` — the article itself. `self` is the feed's own address and
 * `replies` is a comment thread, and both have been mistaken for the article
 * by readers that simply took the first link.
 */
function findAtomLink(value: unknown, base: string): string | null {
  const links = asArray(value);

  const alternate = links.find((link) => {
    const rel = asText(link["@rel"]);
    return rel === null || rel === "alternate";
  });

  const href =
    asText(alternate?.["@href"]) ??
    asText(links[0]?.["@href"]) ??
    // Some producers write Atom links the RSS way, as bare text with no href.
    asText(value);

  return absolute(href, base);
}

function absolute(value: string | null, base: string): string | null {
  if (value === null) {
    return null;
  }

  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

/** Read the text out of whatever shape the parser produced for a field. */
function asText(value: unknown): string | null {
  if (typeof value === "string") {
    return clean(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return asText(value[0]);
  }

  if (typeof value === "object" && value !== null) {
    // An element with attributes arrives as an object, with its text under a
    // "#text" key: <guid isPermaLink="false">abc</guid>.
    return asText((value as XmlNode)["#text"]);
  }

  return null;
}

/**
 * Everything a feed says arrives as markup, whatever the element.
 *
 * Titles included: publishers put `<b>` and `&nbsp;` in them, and a title that
 * reaches a digest with tags still in it looks like a bug in the product rather
 * than in the feed.
 */
function clean(value: string): string | null {
  const text = htmlToText(decodeXmlEntities(value)).trim();
  return text === "" ? null : text;
}

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as XmlNode)
    : undefined;
}

/** One item and a list of items look different to the parser. Here they do not. */
function asArray(value: unknown): XmlNode[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is XmlNode => asNode(entry) !== undefined);
  }

  const node = asNode(value);
  return node === undefined ? [] : [node];
}
