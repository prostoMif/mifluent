import { describe, expect, it } from "vitest";
import { findQuote, normalise } from "./quote.js";

describe("findQuote", () => {
  it("finds an exact quote and returns offsets into the original", () => {
    const material = "Intro. The Pro plan now costs $49 per month. Outro.";

    const match = findQuote(material, "The Pro plan now costs $49 per month.");

    expect(match).not.toBeNull();
    expect(material.slice(match?.startOffset, match?.endOffset)).toBe(
      "The Pro plan now costs $49 per month.",
    );
  });

  it("matches across a line break the model collapsed to a space", () => {
    const material = "The Pro plan\n  now costs $49 per month.";

    const match = findQuote(material, "The Pro plan now costs $49 per month.");

    expect(match?.text).toBe("The Pro plan\n  now costs $49 per month.");
  });

  it("matches straight quotes against curly ones and hyphens against dashes", () => {
    const material = "They said “we’re raising prices” — effective May 1.";

    const match = findQuote(material, `They said "we're raising prices" - effective May 1.`);

    expect(match?.startOffset).toBe(0);
    expect(match?.endOffset).toBe(material.length);
  });

  it("matches a non-breaking space against a normal one", () => {
    const material = "Цена тарифа выросла до 990 ₽.";

    const match = findQuote(material, "Цена тарифа выросла до 990 ₽.");

    expect(match).not.toBeNull();
  });

  it("returns null when the quote is missing from the source", () => {
    const material = "The Pro plan now costs $49 per month.";

    const match = findQuote(material, "The Pro plan now costs $59 per month.");

    expect(match).toBeNull();
  });

  it("does not match a quote whose words were changed", () => {
    const material = "Prices will rise next quarter.";

    const match = findQuote(material, "Prices will increase next quarter.");

    expect(match).toBeNull();
  });

  it("refuses a quote too short to prove anything", () => {
    const match = findQuote("The price changed.", "price");

    expect(match).toBeNull();
  });
});

describe("normalise", () => {
  it("keeps a map from every normalised character back to the original", () => {
    const original = "  a\t— b ";

    const { text, origin } = normalise(original);

    expect(text).toBe("a - b");
    expect(origin.map((index) => original.charAt(index))).toEqual(["a", "\t", "—", " ", "b"]);
  });
});
