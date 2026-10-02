import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  type CataloguedPack,
  matchPacks,
  type ProfileFactsForPacks,
  profileForPacks,
} from "./match.js";
import { NICHES } from "./niches.js";
import { parsePackFile } from "./schema.js";
import { toDefinition } from "./sync.js";

const PACKS_DIR = join(import.meta.dirname, "..", "..", "..", "..", "packs");

function loadCatalogue(): CataloguedPack[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".yaml")) files.push(path);
    }
  };
  walk(PACKS_DIR);
  return files.map((file) => {
    const pack = parsePackFile(file, parse(readFileSync(file, "utf8")));
    return { key: pack.key, definition: toDefinition(pack) };
  });
}

function packsFor(facts: ProfileFactsForPacks, description: string): string[] {
  const profile = profileForPacks(facts, description, NICHES);
  if (profile === undefined) throw new Error("profile not usable for packs");
  return matchPacks(loadCatalogue(), profile).map((pack) => pack.key);
}

describe("the pack catalogue in packs/", () => {
  it("parses, with unique keys", () => {
    const keys = loadCatalogue().map((pack) => pack.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(40);
  });

  it("gives a Wildberries seller in Moscow the marketplace, Russian regulators and seller media", () => {
    const keys = packsFor(
      { country: "RU", market: "ru", region: "RU-MOW", platforms: ["Wildberries"] },
      "Продаём детскую одежду на маркетплейсах",
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "ru.platforms.wildberries",
        "ru.regulators.fns",
        "ru.regulators.fas",
        "ru.media.sellers",
        "ru.regulators.chestny_znak",
      ]),
    );
    expect(keys).not.toContain("ru.platforms.getcourse");
    expect(keys.some((key) => key.startsWith("en."))).toBe(false);
  });

  it("gives an online school GetCourse, Prodamus, regulators and edtech media", () => {
    const keys = packsFor(
      { country: "RU", market: "ru", platforms: ["GetCourse", "Prodamus"] },
      "Онлайн-школа английского языка, курсы для взрослых",
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "ru.platforms.getcourse",
        "ru.platforms.prodamus",
        "ru.regulators.fns",
        "ru.media.edtech",
      ]),
    );
  });

  it("gives a US SaaS on Stripe Stripe, the FTC and IRS, and SaaS media", () => {
    const keys = packsFor(
      { country: "US", market: "en", platforms: ["Stripe"] },
      "B2B SaaS subscription software for small teams",
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "en.platforms.stripe",
        "en.regulators.ftc",
        "en.regulators.irs_small_business",
        "en.media.saastr",
      ]),
    );
    expect(keys).not.toContain("en.regulators.uk_hmrc");
  });

  it("gives a UK Shopify store Shopify, UK regulators and e-commerce media", () => {
    const keys = packsFor(
      { country: "GB", market: "en", platforms: ["Shopify"] },
      "Online store selling handmade candles, ecommerce",
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "en.platforms.shopify",
        "en.regulators.uk_hmrc",
        "en.regulators.uk_cma",
        "en.regulators.uk_ico",
        "en.media.modern_retail",
      ]),
    );
  });

  it("gives a German app developer the app stores and EU and German regulators", () => {
    const keys = packsFor(
      { country: "DE", market: "en", platforms: ["App Store", "Google Play"] },
      "Mobile app for language learning on iOS and Android",
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "en.platforms.apple_app_store",
        "en.platforms.google_play",
        "en.regulators.eu_edpb",
        "en.regulators.eu_digital",
        "en.regulators.de_bnetza",
      ]),
    );
  });
});
