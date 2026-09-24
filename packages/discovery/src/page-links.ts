/**
 * Reading addresses out of a page's HTML. Pure functions over a string.
 *
 * Regular expressions over HTML are usually a mistake; here they are enough,
 * because nothing is being rendered or trusted — every address found is only
 * a candidate, fetched later through the guarded client and kept only if it
 * answers with what it claims to be.
 */

export interface AtsBoard {
  readonly provider: "greenhouse" | "lever" | "ashby";
  readonly token: string;
  readonly apiUrl: string;
}

const TAG = /<(a|link)\b[^>]*>/gi;
const ATTRIBUTE = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

const ATS_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly provider: AtsBoard["provider"];
  readonly api: (token: string) => string;
}[] = [
  {
    pattern:
      /(?:boards|job-boards(?:\.eu)?)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/,
    provider: "greenhouse",
    api: (token) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
  },
  {
    pattern: /jobs\.lever\.co\/([A-Za-z0-9_-]+)/,
    provider: "lever",
    api: (token) => `https://api.lever.co/v0/postings/${token}`,
  },
  {
    pattern: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/,
    provider: "ashby",
    api: (token) => `https://api.ashbyhq.com/posting-api/job-board/${token}`,
  },
];

const GITHUB_REPO = /github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?=["'/?#\s]|$)/;

/** GitHub paths that look like a repository but are not one. */
const GITHUB_NON_REPOS = new Set(["sponsors", "orgs", "features", "about", "pricing", "login"]);

/** `<link rel="alternate" type="application/rss+xml" href>` in any attribute order. */
export function findFeedLinks(html: string, baseUrl: string): string[] {
  const found: string[] = [];

  for (const tag of findTags(html, "link")) {
    const rel = tag.get("rel")?.toLowerCase() ?? "";
    const type = tag.get("type")?.toLowerCase() ?? "";
    const href = tag.get("href");
    const isFeed = type.includes("rss") || type.includes("atom");
    if (!rel.split(/\s+/).includes("alternate") || !isFeed || href === undefined) continue;

    const resolved = resolve(href, baseUrl);
    if (resolved !== null) found.push(resolved);
  }

  return [...new Set(found)];
}

/** Same-site links whose path is exactly one of `paths` (or under it). */
export function findInternalLinks(
  html: string,
  baseUrl: string,
  paths: readonly string[],
): string[] {
  const base = new URL(baseUrl);
  const found: string[] = [];

  for (const tag of findTags(html, "a")) {
    const href = tag.get("href");
    const resolved = href === undefined ? null : resolve(href, baseUrl);
    if (resolved === null) continue;

    const url = new URL(resolved);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const isSameSite = url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
    if (isSameSite && paths.some((candidate) => path === candidate)) {
      url.hash = "";
      found.push(url.toString());
    }
  }

  return [...new Set(found)];
}

/** A link whose visible text is "status", or a `status.` subdomain of the site. */
export function findStatusLink(html: string, baseUrl: string): string | null {
  const byText = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>\s*(?:system\s+)?status\s*<\/a>/i.exec(
    html,
  );
  if (byText?.[1] !== undefined) return resolve(byText[1], baseUrl);

  const host = new URL(baseUrl).hostname.replace(/^www\./, "");
  const bySubdomain = new RegExp(
    `https?://status\\.${host.replace(/\./g, "\\.")}[^"'\\s>]*`,
    "i",
  ).exec(html);
  return bySubdomain?.[0] ?? null;
}

export function findAtsBoard(html: string): AtsBoard | null {
  for (const { pattern, provider, api } of ATS_PATTERNS) {
    const token = pattern.exec(html)?.[1];
    if (token !== undefined && token !== "embed") return { provider, token, apiUrl: api(token) };
  }
  return null;
}

/** The releases feed of the first GitHub repository the page links to. */
export function findGithubReleasesFeed(html: string): string | null {
  const match = GITHUB_REPO.exec(html);
  const owner = match?.[1];
  const repo = match?.[2];
  if (owner === undefined || repo === undefined || GITHUB_NON_REPOS.has(owner.toLowerCase())) {
    return null;
  }
  return `https://github.com/${owner}/${repo}/releases.atom`;
}

function findTags(html: string, name: "a" | "link"): Map<string, string>[] {
  const tags: Map<string, string>[] = [];

  for (const tag of html.matchAll(TAG)) {
    if (tag[1]?.toLowerCase() !== name) continue;
    const attributes = new Map<string, string>();
    for (const attribute of tag[0].matchAll(ATTRIBUTE)) {
      const key = attribute[1]?.toLowerCase();
      const value = attribute[3] ?? attribute[4] ?? attribute[5];
      if (key !== undefined && value !== undefined) attributes.set(key, value);
    }
    tags.push(attributes);
  }

  return tags;
}

function resolve(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href.trim(), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    // Not an address at all — "mailto:" typos, template placeholders. There
    // is nothing to report; the link is simply not a candidate.
    return null;
  }
}
