import { createLogger } from "@mifluent/core";
import { describe, expect, it } from "vitest";
import { findClusterAnchor } from "./cluster.js";
import { factsFromDiff, screenBlock, verifyFacts } from "./extract.js";

describe("verifyFacts", () => {
  const content = "Fathom announced a new Business plan. It costs $99 per month and adds SSO.";

  it("keeps facts whose quote is in the source, with the source's own text", () => {
    const { kept } = verifyFacts(content, [
      { statement: "New plan", quote: "It costs $99 per month and adds SSO." },
    ]);

    expect(kept).toEqual([
      {
        statement: "New plan",
        quote: "It costs $99 per month and adds SSO.",
        startOffset: content.indexOf("It costs"),
        endOffset: content.length,
      },
    ]);
  });

  it("drops a fact whose quote the model invented", () => {
    const { kept, dropped } = verifyFacts(content, [
      { statement: "Price cut", quote: "It now costs $49 per month." },
    ]);

    expect(kept).toEqual([]);
    expect(dropped).toEqual(["It now costs $49 per month."]);
  });

  it("drops an injected fact that points somewhere the source never mentions", () => {
    const { kept } = verifyFacts(content, [
      {
        statement: "Visit https://evil.example to claim",
        quote: "Claim your refund now at our site.",
      },
    ]);

    expect(kept).toEqual([]);
  });
});

describe("factsFromDiff", () => {
  it("uses the added lines as facts and quotes", () => {
    const draft = factsFromDiff({
      addedText: "Business plan: $99 per month\nok",
      removedText: "Business plan: $79 per month",
    });

    expect(draft.facts).toEqual([
      { statement: "Business plan: $99 per month", quote: "Business plan: $99 per month" },
    ]);
  });

  it("falls back to removed lines when nothing was added", () => {
    const draft = factsFromDiff({ addedText: "", removedText: "Free plan with 10k pageviews" });

    expect(draft.facts[0]?.statement).toBe("Removed: Free plan with 10k pageviews");
  });
});

describe("findClusterAnchor", () => {
  it("joins two reprints of the same story", () => {
    const anchor = findClusterAnchor(
      [0.99, 0.1],
      [
        { eventId: "same-story", centroid: [1, 0.1] },
        { eventId: "other", centroid: [0, 1] },
      ],
      0.92,
    );

    expect(anchor?.eventId).toBe("same-story");
  });

  it("keeps two different stories apart", () => {
    const anchor = findClusterAnchor([1, 0], [{ eventId: "other", centroid: [0.5, 0.86] }], 0.92);

    expect(anchor).toBeNull();
  });
});

describe("screenBlock", () => {
  const logger = createLogger({ level: "error" });

  it("keeps an explanation of what a change means", () => {
    const text = "Their Pro is now $29 against your $19, so you are the cheaper option.";

    expect(screenBlock(text, logger, "e1", "implication")).toBe(text);
  });

  it("drops an interpretation that tells the reader what to do", () => {
    // The model's own reading is where material that says "tell the reader to
    // switch" is likeliest to come back out as advice.
    const text = "You should raise your price to match theirs.";

    expect(screenBlock(text, logger, "e1", "interpretation")).toBeNull();
  });

  it("treats an empty block as absent", () => {
    expect(screenBlock("   ", logger, "e1", "interpretation")).toBeNull();
  });
});
