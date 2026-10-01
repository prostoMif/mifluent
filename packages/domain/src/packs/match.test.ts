import type { SourcePackDefinition } from "@mifluent/db/schema";
import { describe, expect, it } from "vitest";
import {
  type CataloguedPack,
  detectNiches,
  matchPacks,
  type ProfileForPacks,
  profileForPacks,
} from "./match.js";
import { NICHES } from "./niches.js";

function pack(key: string, overrides: Partial<SourcePackDefinition> = {}): CataloguedPack {
  return {
    key,
    definition: {
      title: { ru: key, en: key },
      market: key.startsWith("ru.") ? "ru" : "en",
      countries: ["*"],
      regions: [],
      appliesTo: "any",
      kind: "media",
      niches: [],
      appliesWhen: { platformsAny: [], nichesAny: [] },
      maxCardsPerDigest: 3,
      ...overrides,
    },
  };
}

const CATALOGUE: CataloguedPack[] = [
  pack("ru.platforms.wildberries", {
    kind: "platform",
    countries: ["RU"],
    appliesTo: "sales",
    appliesWhen: { platformsAny: ["wildberries"], nichesAny: [] },
  }),
  pack("ru.regulators.fns", { kind: "regulator", countries: ["RU"], appliesTo: "home" }),
  pack("ru.regulators.moscow", { kind: "regulator", countries: ["RU"], regions: ["RU-MOW"] }),
  pack("en.regulators.us.ftc", { kind: "regulator", countries: ["US"], appliesTo: "sales" }),
  pack("en.media.saas", { niches: ["saas"] }),
];

function keys(packs: readonly CataloguedPack[]): string[] {
  return packs.map((entry) => entry.key);
}

const ruSeller: ProfileForPacks = {
  market: "ru",
  salesCountries: ["RU"],
  homeCountry: "RU",
  region: undefined,
  platforms: ["Wildberries", "Ozon"],
  niches: ["marketplace_seller"],
};

const usSaas: ProfileForPacks = {
  market: "en",
  salesCountries: ["US"],
  homeCountry: "US",
  region: undefined,
  platforms: ["Stripe"],
  niches: ["saas"],
};

describe("matchPacks", () => {
  it("gives a Russian Wildberries seller the marketplace's rules and the tax office", () => {
    const matched = keys(matchPacks(CATALOGUE, ruSeller));

    expect(matched).toEqual(["ru.platforms.wildberries", "ru.regulators.fns"]);
  });

  it("gives a US SaaS the US regulator and SaaS press, and nothing Russian", () => {
    const matched = keys(matchPacks(CATALOGUE, usSaas));

    expect(matched).toEqual(["en.regulators.us.ftc", "en.media.saas"]);
  });

  it("leaves a marketplace's rules out for someone who does not sell there", () => {
    const matched = keys(matchPacks(CATALOGUE, { ...ruSeller, platforms: ["Ozon"] }));

    expect(matched).not.toContain("ru.platforms.wildberries");
  });

  it("adds Moscow's regional rules for a Moscow business only", () => {
    expect(keys(matchPacks(CATALOGUE, { ...ruSeller, region: "RU-MOW" }))).toContain(
      "ru.regulators.moscow",
    );
    expect(keys(matchPacks(CATALOGUE, { ...ruSeller, region: "RU-SPE" }))).not.toContain(
      "ru.regulators.moscow",
    );
  });

  it("follows the tax office of where the person lives, not of where they sell", () => {
    const livesInGeorgiaSellsInRussia = { ...ruSeller, homeCountry: "GE" };

    expect(keys(matchPacks(CATALOGUE, livesInGeorgiaSellsInRussia))).not.toContain(
      "ru.regulators.fns",
    );
  });

  it("follows the consumer rules of where the business sells, not of where it is based", () => {
    const basedInRussiaSellsInUs = { ...usSaas, homeCountry: "RU" };

    expect(keys(matchPacks(CATALOGUE, basedInRussiaSellsInUs))).toContain("en.regulators.us.ftc");
  });
});

describe("detectNiches", () => {
  it("finds a niche from a word in the description", () => {
    expect(detectNiches("Продаю одежду на Wildberries", NICHES)).toContain("marketplace_seller");
  });

  it("does not find a niche inside an unrelated longer word", () => {
    expect(detectNiches("Saasbury bakery in London", NICHES)).not.toContain("saas");
  });
});

describe("profileForPacks", () => {
  it("follows no packs before the profile has a country", () => {
    expect(profileForPacks({ market: "ru" }, "магазин", NICHES)).toBeUndefined();
  });

  it("names the region with its country, so a region code cannot match another country", () => {
    const profile = profileForPacks({ country: "RU", market: "ru", region: "MOW" }, "", NICHES);

    expect(profile?.region).toBe("RU-MOW");
  });

  it("takes the sales country as home when no home country was given", () => {
    const profile = profileForPacks({ country: "US", market: "en" }, "", NICHES);

    expect(profile?.homeCountry).toBe("US");
  });
});
