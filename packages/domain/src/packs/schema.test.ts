import { describe, expect, it } from "vitest";
import { parsePackFile } from "./schema.js";

const valid = {
  key: "ru.platforms.wildberries",
  title: { ru: "Wildberries — правила", en: "Wildberries — rules" },
  market: "ru",
  countries: ["RU"],
  kind: "platform",
  applies_when: { platforms_any: ["wildberries"] },
  sources: [
    {
      label: "Новости для продавцов",
      type: "diff",
      url: "https://seller.wildberries.ru/news",
      interval_minutes: 1440,
    },
  ],
};

describe("parsePackFile", () => {
  it("accepts a well-formed pack and fills the defaults", () => {
    const pack = parsePackFile("wildberries.yaml", valid);

    expect(pack.applies_to).toBe("any");
    expect(pack.max_cards_per_digest).toBe(3);
  });

  it("names the file and the field that is wrong", () => {
    const broken = { ...valid, countries: ["Russia"] };

    expect(() => parsePackFile("wildberries.yaml", broken)).toThrow(
      /wildberries\.yaml[\s\S]*countries\.0/,
    );
  });

  it("refuses a key that does not start with the pack's market", () => {
    const wrongMarket = { ...valid, market: "en" };

    expect(() => parsePackFile("wildberries.yaml", wrongMarket)).toThrow(/key/);
  });

  it("refuses a source that is not http or https", () => {
    const ftp = { ...valid, sources: [{ ...valid.sources[0], url: "ftp://example.com/feed" }] };

    expect(() => parsePackFile("wildberries.yaml", ftp)).toThrow(/sources\.0\.url/);
  });

  it("refuses a field the format does not have, so a typo is not silently ignored", () => {
    const typo = { ...valid, aplies_to: "home" };

    expect(() => parsePackFile("wildberries.yaml", typo)).toThrow();
  });
});
