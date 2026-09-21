/**
 * Deciding when two feed items are the same item.
 *
 * The problem this solves is mundane and constant. A press release appears in
 * the company blog feed, in an aggregator's feed and in a news search, three
 * times with three different tracking parameters attached. Without this, the
 * morning digest says the same thing three times and reads like spam.
 *
 * The idea is one every feed reader arrives at, and it is worth stating in full
 * because the details are where it goes wrong:
 *
 * **Identity comes from the most specific thing available, in this order.**
 *
 * 1. **The address**, with tracking parameters removed. Two feeds carrying the
 *    same article agree on the address and on nothing else, so this is the only
 *    identifier that deduplicates *across* sources.
 * 2. **The publisher's own identifier**, combined with the feed it came from.
 *    A `guid` of `post-1` is unique inside one blog and says nothing outside
 *    it, so using it alone would merge two unrelated articles.
 * 3. **The text**, when the item has neither. Weak, but better than treating
 *    every poll's worth of untitled items as new.
 *
 * The order is deliberate: address first, because that is the one that catches
 * the same story arriving by three routes.
 */

import { createHash } from "node:crypto";

/**
 * Parameters that identify where a reader came from rather than what they are
 * reading. Stripped before an address is used as an identifier.
 *
 * A blocklist rather than an allowlist here, and for once that is the right way
 * round: query parameters carry real meaning — an article id, a page number —
 * and dropping an unknown one would merge two genuinely different pages. The
 * cost of missing a tracking parameter is one duplicate in a digest. The cost
 * of dropping a meaningful one is an article nobody ever sees.
 */
const TRACKING_PARAMETERS: readonly string[] = [
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref",
  "ref_src",
  "source",
  "yclid",
];

const TRACKING_PREFIXES: readonly string[] = ["utm_", "at_", "pk_"];

export function canonicaliseUrl(value: string): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    // Not an address. Returned unchanged so the caller can still hash it.
    return value.trim();
  }

  for (const name of [...parsed.searchParams.keys()]) {
    if (isTracking(name)) {
      parsed.searchParams.delete(name);
    }
  }

  // A fragment addresses a place within a page, never a different page.
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();

  // "/posts/1" and "/posts/1/" are one page everywhere except in a hash.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

function isTracking(name: string): boolean {
  const lower = name.toLowerCase();

  return (
    TRACKING_PARAMETERS.includes(lower) ||
    TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

export interface FingerprintInput {
  readonly externalId: string | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly content: string | null;
  /** The feed this item arrived in. Scopes an identifier that is only local. */
  readonly feedUrl: string;
}

/**
 * A stable identifier for an item, as a hex digest.
 *
 * SHA-256 rather than something faster because the cost is irrelevant at this
 * volume and a collision here means one article silently replacing another.
 */
export function fingerprintItem(input: FingerprintInput): string {
  return createHash("sha256").update(identityOf(input)).digest("hex");
}

function identityOf(input: FingerprintInput): string {
  if (input.url !== null && input.url.trim() !== "") {
    return `url:${canonicaliseUrl(input.url)}`;
  }

  if (input.externalId !== null && input.externalId.trim() !== "") {
    return `id:${canonicaliseUrl(input.feedUrl)}:${input.externalId.trim()}`;
  }

  return `text:${(input.title ?? "").trim()}:${(input.content ?? "").trim()}`;
}
