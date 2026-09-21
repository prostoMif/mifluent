/**
 * Discovery: URL or text → profile with targets and verified surfaces.
 *
 * This is the core product feature. It takes a website URL or a text description
 * and returns a structured profile with business info, targets (competitors,
 * platforms, conditions), and verified monitoring surfaces for each target.
 */

import type { LlmClient } from "@mifluent/llm";
import { htmlToText, parseFeed, type SafeFetchResult, safeFetch } from "@mifluent/sources";
import { z } from "zod";
import { DISCOVER_SYSTEM_PROMPT } from "./prompts/discover.js";

// --- Zod schemas -------------------------------------------------------------

export const SurfaceSchema = z.object({
  type: z.enum(["feed", "diff", "json", "query"]),
  url: z.string().url(),
  label: z.string(),
  pollIntervalMinutes: z.number().int().positive(),
  verified: z.boolean(),
});

export type Surface = z.infer<typeof SurfaceSchema>;

export const TargetSchema = z.object({
  kind: z.enum(["competitor", "platform", "condition"]),
  name: z.string(),
  websiteUrl: z.string().url().nullable(),
  reason: z.string(),
  surfaces: z.array(SurfaceSchema),
});

export type Target = z.infer<typeof TargetSchema>;

export const BusinessSchema = z.object({
  name: z.string(),
  description: z.string(),
  niche: z.string(),
  monetization: z.enum(["free", "trial", "subscription", "one_time", "unknown"]),
  platforms: z.array(z.string()),
  countries: z.array(z.string()),
  customerType: z.string(),
  language: z.enum(["en", "ru"]),
});

export type Business = z.infer<typeof BusinessSchema>;

export const DiscoveryResultSchema = z.object({
  business: BusinessSchema,
  targets: z.array(TargetSchema),
  conditions: z.array(
    z.object({
      name: z.string(),
      reason: z.string(),
      surfaces: z.array(SurfaceSchema),
    }),
  ),
  needsDescription: z.boolean().optional(),
});

export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;

// --- Types -------------------------------------------------------------------

export interface DiscoverOptions {
  readonly input: string;
  readonly language?: "en" | "ru";
  readonly llm: LlmClient;
  readonly userAgent?: string;
}

interface InternalPage {
  readonly url: string;
  readonly text: string;
}

// --- Constants ---------------------------------------------------------------

const MAX_TEXT_LENGTH = 12_000;
const MIN_TEXT_LENGTH = 300;
const INTERNAL_PAGES_LIMIT = 3;
const SURFACE_VERIFY_MAX_BYTES = 200_000;
const SURFACE_VERIFY_MIN_TEXT = 200;

const INTERNAL_PATHS = [
  "/pricing",
  "/about",
  "/product",
  "/features",
  "/docs",
  "/blog",
  "/changelog",
  "/releases",
  "/careers",
  "/jobs",
  "/status",
] as const;

const FEED_PATHS = ["/feed", "/rss", "/blog/feed", "/blog/rss.xml", "/atom.xml"] as const;

const CHANGELOG_PATHS = ["/changelog", "/releases", "/whats-new", "/updates"] as const;

const PRICING_PATHS = ["/pricing", "/plans"] as const;

const CAREERS_PATHS = ["/careers", "/jobs"] as const;

const ATS_PATTERNS = [
  {
    pattern: /boards\.greenhouse\.io\/([a-zA-Z0-9-]+)/,
    api: "https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
  },
  { pattern: /jobs\.lever\.co\/([a-zA-Z0-9-]+)/, api: "https://api.lever.co/v0/postings/{token}" },
  {
    pattern: /jobs\.ashbyhq\.com\/([a-zA-Z0-9-]+)/,
    api: "https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true",
  },
] as const;

const GITHUB_PATTERN = /github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+)/;

const RSS_LINK_SELECTOR =
  /<link[^>]+rel=["']alternate["'][^>]+type=["'](application\/rss\+xml|application\/atom\+xml)["'][^>]+href=["']([^"']+)["']/gi;

const STATUS_LINK_SELECTOR = /<a[^>]+href=["']([^"']+)["'][^>]*>\s*status\s*<\/a>/gi;

// --- Main function -----------------------------------------------------------

export async function discover(options: DiscoverOptions): Promise<DiscoveryResult> {
  const {
    input,
    language = "en",
    llm,
    userAgent = "Mifluent/0.1 (+https://mifluent.dev)",
  } = options;

  // Step 1: Determine if input is URL or text
  let material: string;
  let internalPages: InternalPage[] = [];

  if (isUrl(input)) {
    // Fetch main page and internal pages
    const { text: mainText, internalLinks } = await fetchMainPage(input, userAgent);
    material = mainText;

    // If text is too short, return needs_description
    if (material.length < MIN_TEXT_LENGTH) {
      return {
        business: {
          name: "",
          description: "",
          niche: "",
          monetization: "unknown",
          platforms: [],
          countries: [],
          customerType: "",
          language,
        },
        targets: [],
        conditions: [],
        needsDescription: true,
      };
    }

    // Fetch up to 3 internal pages
    internalPages = await fetchInternalPages(internalLinks, userAgent);
    // Combine all text, prioritizing main page
    const allText = [material, ...internalPages.map((p) => p.text)].join("\n\n");
    material = allText.slice(0, MAX_TEXT_LENGTH);
  } else {
    // Input is text description
    material = input.slice(0, MAX_TEXT_LENGTH);
  }

  // Step 2: LLM call to extract business + targets
  const llmResult = await callLlmForDiscovery(llm, material);

  // Step 3: Surface heuristics for each target with websiteUrl
  const targetsWithSurfaces = await Promise.all(
    llmResult.targets.map(async (target) => {
      const surfaces = target.websiteUrl
        ? await findSurfacesForTarget(target, language, userAgent)
        : [];
      return { ...target, surfaces };
    }),
  );

  // Step 4: Conditions with query surfaces
  const conditionsWithSurfaces = buildConditionsSurfaces(llmResult.conditions, language);

  return {
    business: llmResult.business,
    targets: targetsWithSurfaces,
    conditions: conditionsWithSurfaces,
  };
}

// --- Helper functions --------------------------------------------------------

function isUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

async function fetchMainPage(
  url: string,
  userAgent: string,
): Promise<{ text: string; url: string; internalLinks: string[] }> {
  const result = await safeFetch({
    url,
    userAgent,
    maxBytes: SURFACE_VERIFY_MAX_BYTES,
  });

  const html = result.body.toString("utf-8");
  const text = htmlToText(html);

  // Extract internal links for potential crawling
  const internalLinks = extractInternalLinks(html, result.finalUrl);

  // Extract RSS/Atom feed links from HTML
  const feedLinks = extractFeedLinks(html, result.finalUrl);

  return {
    text,
    url: result.finalUrl,
    internalLinks: [...internalLinks, ...feedLinks],
  };
}

async function fetchInternalPages(links: string[], userAgent: string): Promise<InternalPage[]> {
  const results: InternalPage[] = [];
  const seen = new Set<string>();

  for (const link of links.slice(0, INTERNAL_PAGES_LIMIT)) {
    if (seen.has(link)) continue;
    seen.add(link);

    try {
      const result = await safeFetch({
        url: link,
        userAgent,
        maxBytes: SURFACE_VERIFY_MAX_BYTES,
      });

      const html = result.body.toString("utf-8");
      const text = htmlToText(html);

      if (text.length >= MIN_TEXT_LENGTH) {
        results.push({ url: link, text });
      }
    } catch {
      // Silently skip failed internal pages
    }
  }

  return results;
}

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["']/gi;

  for (const match of html.matchAll(linkRegex)) {
    const href = match[1];
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl ?? "");
      // Only same-origin paths from INTERNAL_PATHS
      const pathname = url.pathname;
      if (INTERNAL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
        links.push(url.toString());
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  return [...new Set(links)];
}

function extractFeedLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(RSS_LINK_SELECTOR)) {
    const href = match[2];
    if (!href) continue;
    try {
      links.push(new URL(href, baseUrl ?? "").toString());
    } catch {
      // Ignore
    }
  }
  return [...new Set(links)];
}

async function callLlmForDiscovery(
  llm: LlmClient,
  material: string,
): Promise<{
  business: Business;
  targets: Target[];
  conditions: { name: string; reason: string }[];
}> {
  const schema = z.object({
    business: BusinessSchema,
    targets: z.array(
      z.object({
        kind: z.enum(["competitor", "platform", "condition"]),
        name: z.string(),
        websiteUrl: z.string().url().nullable(),
        reason: z.string(),
      }),
    ),
    conditions: z.array(
      z.object({
        name: z.string(),
        reason: z.string(),
      }),
    ),
  });

  const result = await llm.complete({
    tier: "cheap",
    system: DISCOVER_SYSTEM_PROMPT,
    material,
    schema,
    purpose: "discovery",
    maxOutputTokens: 2000,
    temperature: 0.1,
  });

  return result.value as {
    business: Business;
    targets: Target[];
    conditions: { name: string; reason: string }[];
  };
}

async function findSurfacesForTarget(
  target: Target,
  language: "en" | "ru",
  userAgent: string = "Mifluent/0.1 (+https://mifluent.dev)",
): Promise<Surface[]> {
  if (!target.websiteUrl) return [];

  const surfaces: Surface[] = [];

  // Blog feed
  const blogFeed = await findBlogFeed(target.websiteUrl, userAgent);
  if (blogFeed) surfaces.push(blogFeed);

  // Changelog
  const changelog = await findChangelog(target.websiteUrl, userAgent);
  if (changelog) surfaces.push(changelog);

  // Pricing
  const pricing = await findPricing(target.websiteUrl, userAgent);
  if (pricing) surfaces.push(pricing);

  // Careers/Jobs
  const careers = await findCareers(target.websiteUrl, userAgent);
  if (careers) surfaces.push(careers);

  // Status page
  const status = await findStatusPage(target.websiteUrl, userAgent);
  if (status) surfaces.push(status);

  // GitHub releases
  const github = await findGithubReleases(target.websiteUrl, userAgent);
  if (github) surfaces.push(github);

  // News query
  const newsQuery = buildNewsQuery(target.name, language);
  surfaces.push(newsQuery);

  // Reddit query
  const redditQuery = buildRedditQuery(target.name);
  surfaces.push(redditQuery);

  return surfaces;
}

async function findBlogFeed(baseUrl: string, userAgent: string): Promise<Surface | null> {
  // First check main page for feed links (already done in fetchMainPage)
  // Try common feed paths
  for (const path of FEED_PATHS) {
    try {
      const url = new URL(path, baseUrl).toString();
      const result = await safeFetch({ url, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });
      const feed = await verifyFeed(result, "Blog feed");
      if (feed) return feed;
    } catch {
      // Continue to next path
    }
  }
  return null;
}

async function findChangelog(baseUrl: string, userAgent: string): Promise<Surface | null> {
  for (const path of CHANGELOG_PATHS) {
    try {
      const url = new URL(path, baseUrl).toString();
      const result = await safeFetch({ url, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });

      // Try to find a feed first
      const html = result.body.toString("utf-8");
      const feedLinks = extractFeedLinks(html, url);
      for (const feedUrl of feedLinks) {
        const feedResult = await safeFetch({
          url: feedUrl,
          userAgent,
          maxBytes: SURFACE_VERIFY_MAX_BYTES,
        });
        const feed = await verifyFeed(feedResult, "Changelog feed");
        if (feed) return feed;
      }

      // Fall back to diff
      const text = htmlToText(html);
      if (text.length >= SURFACE_VERIFY_MIN_TEXT) {
        return {
          type: "diff",
          url,
          label: "Changelog",
          pollIntervalMinutes: 1440,
          verified: true,
        };
      }
    } catch {
      // Continue
    }
  }
  return null;
}

async function findPricing(baseUrl: string, userAgent: string): Promise<Surface | null> {
  for (const path of PRICING_PATHS) {
    try {
      const url = new URL(path, baseUrl).toString();
      const result = await safeFetch({ url, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });
      const text = htmlToText(result.body.toString("utf-8"));
      if (text.length >= SURFACE_VERIFY_MIN_TEXT) {
        return {
          type: "diff",
          url,
          label: "Pricing",
          pollIntervalMinutes: 1440,
          verified: true,
        };
      }
    } catch {
      // Continue
    }
  }
  return null;
}

async function findCareers(baseUrl: string, userAgent: string): Promise<Surface | null> {
  for (const path of CAREERS_PATHS) {
    try {
      const url = new URL(path, baseUrl).toString();
      const result = await safeFetch({ url, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });
      const html = result.body.toString("utf-8");

      // Check for ATS patterns
      for (const { pattern, api } of ATS_PATTERNS) {
        const match = html.match(pattern);
        if (match?.[1]) {
          const token = match[1];
          const apiUrl = api.replace("{token}", token);
          return {
            type: "json",
            url: apiUrl,
            label: "Careers (ATS)",
            pollIntervalMinutes: 10080,
            verified: true,
          };
        }
      }

      // Fall back to diff
      const text = htmlToText(html);
      if (text.length >= SURFACE_VERIFY_MIN_TEXT) {
        return {
          type: "diff",
          url,
          label: "Careers",
          pollIntervalMinutes: 10080,
          verified: true,
        };
      }
    } catch {
      // Continue
    }
  }
  return null;
}

async function checkStatusDomain(domain: string, userAgent: string): Promise<Surface | null> {
  for (const path of ["/history.rss", "/history.atom", "/rss", "/feed"]) {
    try {
      const url = new URL(path, `https://${domain}`).toString();
      const result = await safeFetch({ url, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });
      const feed = await verifyFeed(result, "Status feed");
      if (feed) return feed;
    } catch {
      // Continue
    }
  }
  return null;
}

async function checkStatusLinkOnMainPage(
  baseUrl: string,
  userAgent: string,
): Promise<Surface | null> {
  try {
    const result = await safeFetch({ url: baseUrl, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });
    const html = result.body.toString("utf-8");
    for (const match of html.matchAll(STATUS_LINK_SELECTOR)) {
      const href = match[1];
      if (!href) continue;
      try {
        const url = new URL(href, baseUrl).toString();
        const feedResult = await safeFetch({ url, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });
        const feed = await verifyFeed(feedResult, "Status feed");
        if (feed) return feed;
      } catch {
        // Continue
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

async function findStatusPage(baseUrl: string, userAgent: string): Promise<Surface | null> {
  // Check for status.<domain> pattern
  const hostname = new URL(baseUrl).hostname;
  const statusDomain = `status.${hostname.replace(/^www\./, "")}`;

  for (const domain of [statusDomain, baseUrl]) {
    const feed = await checkStatusDomain(domain, userAgent);
    if (feed) return feed;
  }

  // Check for status link on main page
  return checkStatusLinkOnMainPage(baseUrl, userAgent);
}

async function findGithubReleases(baseUrl: string, userAgent: string): Promise<Surface | null> {
  try {
    const result = await safeFetch({ url: baseUrl, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });
    const html = result.body.toString("utf-8");
    const match = html.match(GITHUB_PATTERN);
    if (match) {
      const [, org, repo] = match;
      const url = `https://github.com/${org}/${repo}/releases.atom`;
      const feedResult = await safeFetch({ url, userAgent, maxBytes: SURFACE_VERIFY_MAX_BYTES });
      const feed = await verifyFeed(feedResult, "GitHub releases");
      if (feed) return feed;
    }
  } catch {
    // Ignore
  }
  return null;
}

async function verifyFeed(result: SafeFetchResult, label: string): Promise<Surface | null> {
  try {
    const parsed = parseFeed({
      body: result.body,
      contentType: result.contentType,
      feedUrl: result.finalUrl,
    });
    if (parsed.items.length > 0) {
      return {
        type: "feed",
        url: result.finalUrl,
        label,
        pollIntervalMinutes: 60,
        verified: true,
      };
    }
  } catch {
    // Not a valid feed
  }
  return null;
}

function buildNewsQuery(name: string, language: "en" | "ru"): Surface {
  const encodedName = encodeURIComponent(`"${name}"`);
  const hl = language === "ru" ? "ru" : "en";
  return {
    type: "query",
    url: `https://news.google.com/rss/search?q=${encodedName}&hl=${hl}`,
    label: "Google News",
    pollIntervalMinutes: 60,
    verified: false,
  };
}

function buildRedditQuery(name: string): Surface {
  const encodedName = encodeURIComponent(`"${name}"`);
  return {
    type: "query",
    url: `https://www.reddit.com/search.rss?q=${encodedName}&sort=new`,
    label: "Reddit",
    pollIntervalMinutes: 60,
    verified: false,
  };
}

function buildConditionsSurfaces(
  conditions: { name: string; reason: string }[],
  language: "en" | "ru",
): { name: string; reason: string; surfaces: Surface[] }[] {
  return conditions.map((condition) => ({
    ...condition,
    surfaces: [
      {
        type: "query" as const,
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(`"${condition.name}"`)}&hl=${language}`,
        label: "Google News",
        pollIntervalMinutes: 60,
        verified: false,
      },
    ],
  }));
}
