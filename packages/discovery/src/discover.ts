/**
 * Discovery: a website or a sentence in, a proposal of what to watch out.
 *
 * 1. For a URL: the homepage and up to three of /pricing, /about, /product —
 *    only if the homepage links to them. A site that says less than a few
 *    hundred characters is a business card; the answer is "describe it".
 * 2. One cheap model call: the business, and candidate targets and conditions.
 * 3. For every target, surfaces by heuristic — see `surfaces.ts` — each one
 *    fetched and marked verified or not.
 *
 * Nothing is written to the database. The onboarding flow shows the result to
 * a person, who decides what is kept.
 */

import { httpUrlSchema, type Logger } from "@mifluent/core";
import type { LlmClient } from "@mifluent/llm";
import { findInternalLinks } from "./page-links.js";
import { createProber, type Prober } from "./probe.js";
import { buildDiscoverPrompt, DISCOVER_PROMPT_VERSION } from "./prompts/discover.js";
import { type DiscoveryResult, type ModelAnswer, modelAnswerSchema } from "./schemas.js";
import { findConditionSurfaces, findTargetSurfaces } from "./surfaces.js";

export interface DiscoverOptions {
  /** A website address, or a sentence describing the business. */
  readonly input: string;
  readonly language: "en" | "ru";
  readonly llm: LlmClient;
  readonly userAgent: string;
  /** Whose budget the model call is charged to, and which run it belongs to. */
  readonly tenantId?: string | undefined;
  readonly runId?: string | undefined;
  readonly logger?: Logger | undefined;
  /** Replaces the network, for tests. */
  readonly prober?: Prober | undefined;
}

/** What goes to the model: enough for a homepage and a pricing page. */
const MAX_MATERIAL_LENGTH = 12_000;

/** Below this, a site has not said what the business does. */
const MIN_SITE_TEXT = 300;

const INTERNAL_PATHS = ["/pricing", "/about", "/product"] as const;

/** Targets probed at once. Each probe is a handful of requests to one host. */
const TARGET_CONCURRENCY = 3;

export async function discover(options: DiscoverOptions): Promise<DiscoveryResult> {
  const prober =
    options.prober ?? createProber({ userAgent: options.userAgent, logger: options.logger });
  const url = asWebsite(options.input);

  const material =
    url === null ? options.input.slice(0, MAX_MATERIAL_LENGTH) : await readSite(prober, url);
  if (material === null) {
    return emptyResult(options.language);
  }

  const { value } = await options.llm.complete({
    tier: "cheap",
    system: buildDiscoverPrompt(options.language),
    material,
    schema: modelAnswerSchema,
    purpose: "discovery",
    temperature: 0.1,
    maxOutputTokens: 2_000,
    ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
    ...(options.runId === undefined ? {} : { tags: { runId: options.runId } }),
  });

  options.logger?.info("discovery.answered", {
    promptVersion: DISCOVER_PROMPT_VERSION,
    targets: value.targets.length,
    conditions: value.conditions.length,
  });

  return assemble(value, { prober, language: options.language });
}

async function assemble(
  answer: ModelAnswer,
  context: { readonly prober: Prober; readonly language: "en" | "ru" },
): Promise<DiscoveryResult> {
  const targets = await mapLimited(answer.targets, TARGET_CONCURRENCY, async (target) => {
    const websiteUrl = normaliseWebsite(target.websiteUrl);
    return {
      kind: target.kind,
      name: target.name,
      websiteUrl,
      reason: target.reason,
      surfaces: await findTargetSurfaces({ name: target.name, websiteUrl }, context),
    };
  });

  const conditions = await Promise.all(
    answer.conditions.map(async (condition) => ({
      ...condition,
      surfaces: await findConditionSurfaces(condition, context),
    })),
  );

  return { business: answer.business, targets, conditions, needsDescription: false };
}

/** Homepage plus linked internal pages as one text, or null for a business-card site. */
async function readSite(prober: Prober, url: string): Promise<string | null> {
  const home = await prober.fetchPage(url);
  if (home === null || home.text.length < MIN_SITE_TEXT) return null;

  const links = findInternalLinks(home.html, home.url, INTERNAL_PATHS).slice(
    0,
    INTERNAL_PATHS.length,
  );
  const pages = await Promise.all(links.map((link) => prober.fetchPage(link)));
  const texts = [home.text, ...pages.flatMap((page) => (page === null ? [] : [page.text]))];

  return texts.join("\n\n").slice(0, MAX_MATERIAL_LENGTH);
}

/** The input as a website address, if it is one. "acme.com" counts. */
function asWebsite(input: string): string | null {
  const trimmed = input.trim();
  if (/\s/.test(trimmed)) return null;
  return normaliseWebsite(trimmed);
}

/**
 * A model or a person writes "acme.com" as often as "https://acme.com". The
 * scheme is added, then the result must still be an http(s) address with a
 * dotted host — anything else is dropped rather than fetched.
 */
export function normaliseWebsite(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const withScheme = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  const parsed = httpUrlSchema.safeParse(withScheme);
  if (!parsed.success) return null;
  return new URL(parsed.data).hostname.includes(".") ? parsed.data : null;
}

function emptyResult(language: "en" | "ru"): DiscoveryResult {
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

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await map(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
