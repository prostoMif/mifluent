/**
 * Which source packs a profile follows.
 *
 * Pure functions over a profile's facts and the pack catalogue. Computed at
 * selection time rather than stored: the answer changes whenever a person edits
 * their country or platforms, or a contributor adds a pack, and a stored copy
 * would always be one of those changes behind.
 */

import type { SourcePackDefinition } from "@mifluent/db/schema";
import type { NicheDictionary } from "./schema.js";

export interface CataloguedPack {
  readonly key: string;
  readonly definition: SourcePackDefinition;
}

export interface ProfileForPacks {
  readonly market: "ru" | "en";
  /** Where the business sells: the primary country first. */
  readonly salesCountries: readonly string[];
  /** Where the person lives or the business is registered. */
  readonly homeCountry: string;
  /** ISO 3166-2, e.g. `RU-MOW`; absent when not given. */
  readonly region: string | undefined;
  /** Lower-cased platform names from the profile's facts. */
  readonly platforms: readonly string[];
  /** Niche keys detected from the profile's description. */
  readonly niches: readonly string[];
}

/** The packs that apply to a profile, in catalogue order. */
export function matchPacks(
  packs: readonly CataloguedPack[],
  profile: ProfileForPacks,
): CataloguedPack[] {
  return packs.filter((pack) => packApplies(pack.definition, profile));
}

/**
 * Niche keys whose aliases appear in the given text, matched as whole words.
 * Deliberately no model: the dictionary is small, and a reader can see in the
 * YAML exactly why a profile got a niche's sources.
 */
export function detectNiches(text: string, dictionary: NicheDictionary): string[] {
  const normalised = ` ${normaliseWords(text)} `;
  const found: string[] = [];

  for (const [key, entry] of Object.entries(dictionary)) {
    const aliases = [...entry.aliases.ru, ...entry.aliases.en];
    if (aliases.some((alias) => normalised.includes(` ${normaliseWords(alias)} `))) {
      found.push(key);
    }
  }
  return found;
}

function packApplies(pack: SourcePackDefinition, profile: ProfileForPacks): boolean {
  if (pack.market !== profile.market) return false;
  if (!countryApplies(pack, profile)) return false;
  if (!regionApplies(pack, profile)) return false;
  if (pack.niches.length > 0 && !intersects(pack.niches, profile.niches)) return false;
  return conditionsApply(pack, profile);
}

function countryApplies(pack: SourcePackDefinition, profile: ProfileForPacks): boolean {
  if (pack.countries.includes("*")) return true;

  const candidates =
    pack.appliesTo === "home"
      ? [profile.homeCountry]
      : pack.appliesTo === "sales"
        ? profile.salesCountries
        : [profile.homeCountry, ...profile.salesCountries];
  return intersects(pack.countries, candidates);
}

function regionApplies(pack: SourcePackDefinition, profile: ProfileForPacks): boolean {
  if (pack.regions.length === 0) return true;
  return profile.region !== undefined && pack.regions.includes(profile.region);
}

/**
 * `applies_when` narrows a pack to profiles that use something specific — a
 * marketplace's rules only matter to its sellers. No condition means the pack
 * applies to everyone the country and niche already let through.
 */
function conditionsApply(pack: SourcePackDefinition, profile: ProfileForPacks): boolean {
  const { platformsAny, nichesAny } = pack.appliesWhen;
  if (platformsAny.length === 0 && nichesAny.length === 0) return true;

  const platforms = profile.platforms.map((platform) => normaliseWords(platform));
  const usesPlatform = platformsAny.some((wanted) =>
    platforms.some((platform) => platform.includes(normaliseWords(wanted))),
  );
  return usesPlatform || intersects(nichesAny, profile.niches);
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return left.some((value) => right.includes(value));
}

function normaliseWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface ProfileFactsForPacks {
  readonly country?: string | undefined;
  readonly extraCountries?: readonly string[] | undefined;
  readonly homeCountry?: string | undefined;
  readonly region?: string | undefined;
  readonly market?: "ru" | "en" | undefined;
  readonly platforms?: readonly string[] | undefined;
  readonly whatMatters?: string | undefined;
  readonly customerType?: string | undefined;
}

/**
 * The matching view of a profile, or undefined when it has no country yet —
 * a profile from before countries were asked for follows no packs rather than
 * guessing one.
 */
export function profileForPacks(
  facts: ProfileFactsForPacks,
  description: string,
  dictionary: NicheDictionary,
): ProfileForPacks | undefined {
  if (facts.country === undefined || facts.market === undefined) return undefined;

  const text = [description, facts.whatMatters ?? "", facts.customerType ?? ""].join(" ");
  return {
    market: facts.market,
    salesCountries: [facts.country, ...(facts.extraCountries ?? [])],
    homeCountry: facts.homeCountry ?? facts.country,
    // Profiles store the subdivision alone ("MOW"); packs name it in full
    // ("RU-MOW") so a region code can never match the wrong country.
    region: facts.region === undefined ? undefined : `${facts.country}-${facts.region}`,
    platforms: facts.platforms ?? [],
    niches: detectNiches(text, dictionary),
  };
}
