/**
 * Where to watch a target: heuristics, no model.
 *
 * Each target's homepage is fetched once and read for a feed link, a status
 * page, a GitHub repository and a job board; then a short list of
 * conventional paths is tried. Every surface is fetched before it is offered
 * and marked verified or not — an unverified one is still offered, because a
 * person may know it works, but it is marked so they can tell.
 */

import {
  findAtsBoard,
  findFeedLinks,
  findGithubReleasesFeed,
  findStatusLink,
} from "./page-links.js";
import type { FetchedPage, Prober } from "./probe.js";
import type { Surface } from "./schemas.js";

const FEED_PATHS = [
  "/feed",
  "/rss",
  "/blog/feed",
  "/blog/rss.xml",
  "/atom.xml",
  "/rss.xml",
] as const;
const CHANGELOG_PATHS = ["/changelog", "/releases", "/whats-new", "/updates"] as const;
const PRICING_PATHS = ["/pricing", "/plans"] as const;
const CAREERS_PATHS = ["/careers", "/jobs"] as const;
const STATUS_FEED_PATHS = ["/history.rss", "/history.atom"] as const;

/** A page this short is a redirect notice or an error page, not something to diff. */
const MIN_PAGE_TEXT = 200;

/** Minutes. A day for pages that change on business time, a week for hiring. */
const INTERVAL = {
  feed: 60,
  diff: 1_440,
  jobs: 10_080,
  query: 60,
} as const;

export async function findTargetSurfaces(
  target: { readonly name: string; readonly websiteUrl: string | null },
  context: { readonly prober: Prober; readonly language: "en" | "ru" },
): Promise<Surface[]> {
  const surfaces: Surface[] = [];
  const { prober } = context;

  if (target.websiteUrl !== null) {
    const home = await prober.fetchPage(target.websiteUrl);
    const base = home?.url ?? target.websiteUrl;

    const found = await Promise.all([
      findBlogFeed(prober, base, home),
      findChangelog(prober, base),
      findPricing(prober, base),
      findCareers(prober, base, home),
      findStatusFeed(prober, base, home),
      findGithubReleases(prober, home),
    ]);
    for (const surface of found) {
      if (surface !== null) surfaces.push(surface);
    }
  }

  surfaces.push(await newsQuery(prober, target.name, context.language));
  surfaces.push(await redditQuery(prober, target.name));
  return surfaces;
}

export async function findConditionSurfaces(
  condition: { readonly name: string },
  context: { readonly prober: Prober; readonly language: "en" | "ru" },
): Promise<Surface[]> {
  return [await newsQuery(context.prober, condition.name, context.language)];
}

async function findBlogFeed(
  prober: Prober,
  base: string,
  home: FetchedPage | null,
): Promise<Surface | null> {
  const advertised = home === null ? [] : findFeedLinks(home.html, home.url);
  const candidates = [...advertised, ...FEED_PATHS.map((path) => new URL(path, base).toString())];

  for (const url of candidates) {
    if (await prober.isFeed(url)) return feedSurface(url, "Blog");
  }
  return null;
}

async function findChangelog(prober: Prober, base: string): Promise<Surface | null> {
  for (const path of CHANGELOG_PATHS) {
    const page = await prober.fetchPage(new URL(path, base).toString());
    if (page === null || page.text.length < MIN_PAGE_TEXT) continue;

    for (const feedUrl of findFeedLinks(page.html, page.url)) {
      if (await prober.isFeed(feedUrl)) return feedSurface(feedUrl, "Changelog");
    }
    return diffSurface(page.url, "Changelog", INTERVAL.diff);
  }
  return null;
}

async function findPricing(prober: Prober, base: string): Promise<Surface | null> {
  for (const path of PRICING_PATHS) {
    const page = await prober.fetchPage(new URL(path, base).toString());
    if (page !== null && page.text.length >= MIN_PAGE_TEXT) {
      return diffSurface(page.url, "Pricing", INTERVAL.diff);
    }
  }
  return null;
}

async function findCareers(
  prober: Prober,
  base: string,
  home: FetchedPage | null,
): Promise<Surface | null> {
  const onHome = home === null ? null : findAtsBoard(home.html);
  if (onHome !== null) return jobsSurface(prober, onHome.apiUrl);

  for (const path of CAREERS_PATHS) {
    const page = await prober.fetchPage(new URL(path, base).toString());
    if (page === null) continue;

    const board = findAtsBoard(page.html);
    if (board !== null) return jobsSurface(prober, board.apiUrl);
    if (page.text.length >= MIN_PAGE_TEXT) return diffSurface(page.url, "Careers", INTERVAL.jobs);
  }
  return null;
}

async function findStatusFeed(
  prober: Prober,
  base: string,
  home: FetchedPage | null,
): Promise<Surface | null> {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const linked = home === null ? null : findStatusLink(home.html, home.url);
  const roots = [
    ...new Set([linked, `https://status.${host}`].filter((root): root is string => root !== null)),
  ];

  for (const root of roots) {
    for (const path of STATUS_FEED_PATHS) {
      const url = new URL(path, root).toString();
      if (await prober.isFeed(url)) return feedSurface(url, "Status");
    }
  }
  return null;
}

async function findGithubReleases(
  prober: Prober,
  home: FetchedPage | null,
): Promise<Surface | null> {
  const feed = home === null ? null : findGithubReleasesFeed(home.html);
  if (feed === null) return null;
  return (await prober.isFeed(feed)) ? feedSurface(feed, "GitHub releases") : null;
}

async function newsQuery(prober: Prober, name: string, language: "en" | "ru"): Promise<Surface> {
  const region = language === "ru" ? "hl=ru&gl=RU&ceid=RU:ru" : "hl=en-US&gl=US&ceid=US:en";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}"`)}&${region}`;
  return { ...querySurface(url, "Google News"), verified: await prober.isFeed(url) };
}

async function redditQuery(prober: Prober, name: string): Promise<Surface> {
  const url = `https://www.reddit.com/search.rss?q=${encodeURIComponent(`"${name}"`)}&sort=new`;
  return { ...querySurface(url, "Reddit"), verified: await prober.isFeed(url) };
}

function feedSurface(url: string, label: string): Surface {
  return { type: "feed", url, label, pollIntervalMinutes: INTERVAL.feed, verified: true };
}

function diffSurface(url: string, label: string, pollIntervalMinutes: number): Surface {
  return { type: "diff", url, label, pollIntervalMinutes, verified: true };
}

async function jobsSurface(prober: Prober, url: string): Promise<Surface> {
  const verified = (await prober.fetchPage(url)) !== null;
  return { type: "json", url, label: "Jobs", pollIntervalMinutes: INTERVAL.jobs, verified };
}

function querySurface(url: string, label: string): Surface {
  return { type: "query", url, label, pollIntervalMinutes: INTERVAL.query, verified: false };
}
