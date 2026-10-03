/**
 * What a local business's competitors show on their sites right now: the
 * home page plus the pages most likely to carry offers — promotions, prices,
 * news. A first digest has no history to compare against, so "what they
 * offer today" is what it can honestly show.
 */

import { htmlToText, safeFetch } from "@mifluent/sources";
import { logger, USER_AGENT } from "../runtime.js";

export interface CompetitorPage {
  readonly competitor: string;
  readonly url: string;
  readonly text: string;
}

const OFFER_WORDS =
  /акци|скидк|спецпредлож|предложени|цен[аыу]|прайс|стоимост|новост|sale|promo|price|news|offer/i;
const MAX_EXTRA_PAGES = 3;
const MAX_TEXT = 3_000;
const MAX_BYTES = 2_000_000;

const cache = new Map<string, Promise<string | null>>();

async function fetchHtml(url: string): Promise<string | null> {
  const known = cache.get(url);
  if (known !== undefined) return known;
  const pending = (async () => {
    try {
      const response = await safeFetch({ url, userAgent: USER_AGENT, maxBytes: MAX_BYTES });
      if (response.status >= 400) return null;
      return response.body.toString("utf8");
    } catch (error) {
      logger.warn("leads.page_failed", { url, cause: error });
      return null;
    }
  })();
  cache.set(url, pending);
  return pending;
}

/** Same-site links whose address or visible text mentions offers or prices. */
export function findOfferLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const found = new Set<string>();
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1] ?? "";
    const label = htmlToText(match[2] ?? "");
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    const sameSite = url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
    if (!sameSite || !/^https?:$/.test(url.protocol)) continue;
    if (!OFFER_WORDS.test(decodeURIComponent(url.pathname)) && !OFFER_WORDS.test(label)) continue;
    url.hash = "";
    if (url.toString() !== base.toString()) found.add(url.toString());
  }
  return [...found].slice(0, MAX_EXTRA_PAGES);
}

export async function competitorPages(
  competitor: string,
  website: string,
): Promise<CompetitorPage[]> {
  const home = await fetchHtml(website);
  if (home === null) return [];
  const pages: CompetitorPage[] = [
    { competitor, url: website, text: htmlToText(home).slice(0, MAX_TEXT) },
  ];
  for (const url of findOfferLinks(home, website)) {
    const html = await fetchHtml(url);
    if (html !== null) pages.push({ competitor, url, text: htmlToText(html).slice(0, MAX_TEXT) });
  }
  return pages.filter((page) => page.text.length > 50);
}
