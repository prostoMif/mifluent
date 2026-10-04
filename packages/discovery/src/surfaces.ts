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

/**
 * Minutes. A day for pages that change on business time, a week for hiring.
 *
 * Searches (Google News, Reddit) every four hours: one server asks for every
 * profile from one address, and Google answers frequent automated queries
 * with 503 "automated access blocked". A news story is not worse for arriving
 * a few hours later in a daily or weekly digest.
 */
const INTERVAL = {
  feed: 60,
  diff: 1_440,
  jobs: 10_080,
  query: 240,
} as const;

/** Telegram channel username pattern: t.me/<username> or telegram.me/<username>, not private invite links. */
const TELEGRAM_CHANNEL_PATTERN = /(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{5,32})(?![A-Za-z0-9_])/g;

/** YouTube channel patterns. */
const YOUTUBE_HANDLE_PATTERN = /youtube\.com\/@([A-Za-z0-9_.-]+)/g;
const YOUTUBE_CHANNEL_ID_PATTERN = /youtube\.com\/channel\/(UC[\w-]{22})/g;
const YOUTUBE_CUSTOM_PATTERN = /youtube\.com\/c\/([A-Za-z0-9_.-]+)/g;

/** RSSHub base URL from environment. */
function getRsshubBase(): string {
  const base = process.env["RSSHUB_URL"] ?? "http://rsshub:1200";
  return base.replace(/\/+$/, "");
}

/**
 * Resolve an rsshub:telegram/<username> locator to the full RSSHub URL.
 * Exported for source-pack loaders (TASK-033).
 */
export function resolveRsshub(locator: string): string | null {
  const match = /^rsshub:telegram\/([A-Za-z0-9_]{5,32})$/.exec(locator);
  if (!match) return null;
  return `${getRsshubBase()}/telegram/channel/${match[1]}`;
}

export async function findTargetSurfaces(
  target: {
    readonly name: string;
    readonly websiteUrl: string | null;
    readonly newsQuery?: string;
  },
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

    // These return arrays (multiple surfaces possible).
    const telegramSurfaces = await findTelegramChannels(prober, home);
    surfaces.push(...telegramSurfaces);
    const youtubeSurfaces = await findYouTubeChannels(prober, home);
    surfaces.push(...youtubeSurfaces);
  }

  surfaces.push(await newsQuery(prober, target.name, context.language, target.newsQuery));
  const redditSurface = await redditQuery(prober, target.name, context.language);
  if (redditSurface !== null) surfaces.push(redditSurface);
  return surfaces;
}

/**
 * Surfaces for the 'self' target (brand mentions).
 * Google News for both languages, Reddit and HN only for English.
 */
export async function findSelfSurfaces(
  business: { readonly name: string; readonly websiteUrl: string | null },
  context: { readonly prober: Prober; readonly language: "en" | "ru" },
): Promise<Surface[]> {
  const surfaces: Surface[] = [];
  const { prober, language } = context;

  // Google News: search for business name OR domain
  const queryParts = [`"${business.name}"`];
  if (business.websiteUrl !== null) {
    try {
      const domain = new URL(business.websiteUrl).hostname.replace(/^www\./, "");
      queryParts.push(`"${domain}"`);
    } catch {
      // Invalid URL, skip domain
    }
  }
  const query = queryParts.join(" OR ");
  const region = language === "ru" ? "hl=ru&gl=RU&ceid=RU:ru" : "hl=en-US&gl=US&ceid=US:en";
  const newsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${region}`;
  surfaces.push({
    ...querySurface(newsUrl, "Google News"),
    verified: await prober.isFeed(newsUrl),
  });

  // Reddit and HN only for English
  if (language === "en") {
    const redditUrl = `https://www.reddit.com/search.rss?q=${encodeURIComponent(`"${business.name}"`)}&sort=new`;
    const redditVerified = await prober.isFeed(redditUrl);
    if (redditVerified) {
      surfaces.push({ ...querySurface(redditUrl, "Reddit"), verified: true });
    }

    const hnUrl = `https://hnrss.org/newest?q=${encodeURIComponent(business.name)}`;
    const hnVerified = await prober.isFeed(hnUrl);
    if (hnVerified) {
      surfaces.push({ ...querySurface(hnUrl, "Hacker News"), verified: true });
    }
  }

  return surfaces;
}

export async function findConditionSurfaces(
  condition: { readonly name: string; readonly newsQuery?: string },
  context: { readonly prober: Prober; readonly language: "en" | "ru" },
): Promise<Surface[]> {
  return [await newsQuery(context.prober, condition.name, context.language, condition.newsQuery)];
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

/**
 * Find public Telegram channels linked on the homepage.
 * Only t.me/<username> and telegram.me/<username> — not t.me/+... or joinchat invite links.
 * Max 2 channels per target.
 */
export async function findTelegramChannels(
  prober: Prober,
  home: FetchedPage | null,
): Promise<Surface[]> {
  if (home === null) return [];

  const channels = new Set<string>();
  for (const match of home.html.matchAll(TELEGRAM_CHANNEL_PATTERN)) {
    const username = match[1];
    if (username && !username.startsWith("+") && username !== "joinchat") {
      channels.add(username.toLowerCase());
    }
  }

  const surfaces: Surface[] = [];
  for (const username of Array.from(channels).slice(0, 2)) {
    const url = `${getRsshubBase()}/telegram/channel/${username}`;
    const verified = await prober.isFeed(url);
    if (verified) {
      surfaces.push(feedSurface(url, "Telegram"));
    }
  }
  return surfaces;
}

/**
 * Find YouTube channels linked on the homepage.
 * Resolve channel_id from the channel page (canonical link or JSON-LD).
 * Max 1 channel per target.
 */
async function findYouTubeChannels(prober: Prober, home: FetchedPage | null): Promise<Surface[]> {
  if (home === null) return [];

  const handles = collectYouTubeHandles(home.html);

  for (const handle of handles) {
    const channelId = await resolveYouTubeChannelId(prober, handle);
    if (channelId !== null) {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const verified = await prober.isFeed(url);
      if (verified) {
        return [feedSurface(url, "YouTube", INTERVAL.feed * 6)]; // 360 min
      }
    }
  }
  return [];
}

function collectYouTubeHandles(html: string): Set<string> {
  const handles = new Set<string>();
  for (const match of html.matchAll(YOUTUBE_HANDLE_PATTERN)) {
    const handle = match[1];
    if (handle !== undefined) handles.add(handle);
  }
  for (const match of html.matchAll(YOUTUBE_CHANNEL_ID_PATTERN)) {
    const handle = match[1];
    if (handle !== undefined) handles.add(handle);
  }
  for (const match of html.matchAll(YOUTUBE_CUSTOM_PATTERN)) {
    const handle = match[1];
    if (handle !== undefined) handles.add(handle);
  }
  return handles;
}

async function resolveYouTubeChannelId(prober: Prober, handle: string): Promise<string | null> {
  // If it's already a channel ID (UC...), use it directly.
  if (handle.startsWith("UC") && handle.length === 24) {
    return handle;
  }

  // Fetch the channel page to resolve the channel ID.
  const channelUrl = handle.startsWith("UC")
    ? `https://www.youtube.com/channel/${handle}`
    : `https://www.youtube.com/@${handle}`;
  const page = await prober.fetchPage(channelUrl);
  if (page === null) return null;

  return extractYouTubeChannelId(page.html, page.url);
}

/** Extract YouTube channel ID from channel page HTML. */
function extractYouTubeChannelId(html: string, _baseUrl: string): string | null {
  // Try <link rel="canonical" href="https://www.youtube.com/channel/UC...">
  const canonicalMatch =
    /<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/i.exec(
      html,
    );
  if (canonicalMatch?.[1]) return canonicalMatch[1];

  // Try "channelId":"UC..." in JSON-LD or ytInitialData
  const channelIdMatch = /"channelId"\s*:\s*"(UC[\w-]{22})"/.exec(html);
  if (channelIdMatch?.[1]) return channelIdMatch[1];

  // Try meta tag
  const metaMatch =
    /<meta\s+property="og:url"\s+content="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/i.exec(
      html,
    );
  if (metaMatch?.[1]) return metaMatch[1];

  return null;
}

async function newsQuery(
  prober: Prober,
  name: string,
  language: "en" | "ru",
  newsQuery?: string,
): Promise<Surface> {
  const region = language === "ru" ? "hl=ru&gl=RU&ceid=RU:ru" : "hl=en-US&gl=US&ceid=US:en";
  const trimmed = newsQuery?.trim();
  const query = trimmed && trimmed.length > 0 ? trimmed : `"${name}"`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${region}`;
  return { ...querySurface(url, "Google News"), verified: await prober.isFeed(url) };
}

/**
 * Reddit search surface — only created if the feed is reachable from the server.
 * If not reachable, returns null (surface not created at all).
 */
async function redditQuery(
  prober: Prober,
  name: string,
  language: "en" | "ru",
): Promise<Surface | null> {
  // For Russian language, Reddit is not added by default (very little Russian content).
  if (language === "ru") return null;

  const url = `https://www.reddit.com/search.rss?q=${encodeURIComponent(`"${name}"`)}&sort=new`;
  const verified = await prober.isFeed(url);
  if (!verified) return null; // Do not create unverified Reddit surface.
  return { ...querySurface(url, "Reddit"), verified: true };
}

function feedSurface(
  url: string,
  label: string,
  pollIntervalMinutes: number = INTERVAL.feed,
): Surface {
  return { type: "feed", url, label, pollIntervalMinutes, verified: true };
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
