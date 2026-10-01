import { describe, expect, it } from "vitest";
import type { RelevanceAnswer } from "../prompts/selection.js";
import { articleEventKind, isUrgentRule, isWrongCountry } from "./market-rules.js";

function answer(overrides: Partial<RelevanceAnswer> = {}): RelevanceAnswer {
  return {
    relevant: true,
    targetId: null,
    reason: "A tax change",
    scope: "market_rule",
    geo: null,
    effectiveDate: null,
    ...overrides,
  };
}

const NOW = new Date("2026-10-01T09:00:00Z");

describe("isWrongCountry", () => {
  it("rejects a German rule for a business in Russia", () => {
    expect(isWrongCountry(answer({ geo: "DE" }), { country: "RU" })).toBe(true);
  });

  it("accepts a rule about the country the business is based in", () => {
    expect(isWrongCountry(answer({ geo: "GE" }), { country: "RU", homeCountry: "GE" })).toBe(false);
  });

  it("accepts a rule about an extra country the business sells in", () => {
    expect(isWrongCountry(answer({ geo: "KZ" }), { country: "RU", extraCountries: ["KZ"] })).toBe(
      false,
    );
  });

  it("accepts a worldwide rule with no country", () => {
    expect(isWrongCountry(answer({ geo: null }), { country: "RU" })).toBe(false);
  });

  it("does not judge a competitor story by country", () => {
    expect(isWrongCountry(answer({ scope: "competitor", geo: "US" }), { country: "RU" })).toBe(
      false,
    );
  });

  it("does not overrule the model for a profile without countries", () => {
    expect(isWrongCountry(answer({ geo: "DE" }), {})).toBe(false);
  });
});

describe("isUrgentRule", () => {
  it("is urgent when the rule takes effect within thirty days", () => {
    expect(isUrgentRule(answer({ effectiveDate: "2026-10-20" }), NOW)).toBe(true);
  });

  it("is not urgent without a stated date", () => {
    expect(isUrgentRule(answer({ effectiveDate: null }), NOW)).toBe(false);
  });

  it("is not urgent when the date is months away", () => {
    expect(isUrgentRule(answer({ effectiveDate: "2027-03-01" }), NOW)).toBe(false);
  });

  it("is not urgent when the date has passed", () => {
    expect(isUrgentRule(answer({ effectiveDate: "2026-09-01" }), NOW)).toBe(false);
  });

  it("is never urgent for market news", () => {
    expect(isUrgentRule(answer({ scope: "market_news", effectiveDate: "2026-10-05" }), NOW)).toBe(
      false,
    );
  });
});

describe("articleEventKind", () => {
  it("keeps the scope of market material", () => {
    expect(articleEventKind("article", "market_rule")).toBe("market_rule");
  });

  it("calls a competitor article news", () => {
    expect(articleEventKind("article", "competitor")).toBe("news");
  });

  it("calls a release a feature whatever its scope", () => {
    expect(articleEventKind("release", "platform")).toBe("feature");
  });
});
