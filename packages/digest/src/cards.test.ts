import { describe, expect, it } from "vitest";
import { assembleCards, type EventForCard, linkToQuote, MARKET_SECTION_LIMIT } from "./cards.js";

const PERIOD_END = new Date("2026-09-28T08:00:00Z");

function event(overrides: Partial<EventForCard> = {}): EventForCard {
  return {
    id: "event-1",
    summary: "Fathom raised the price of its Business plan",
    implication: null,
    interpretation: null,
    isUrgent: false,
    relevanceScore: 0.8,
    occurredAt: new Date("2026-09-25T08:00:00Z"),
    createdAt: new Date("2026-09-25T09:00:00Z"),
    targetId: null,
    targetName: null,
    targetKind: null,
    sourceUrl: "https://usefathom.com/pricing",
    facts: [{ statement: "Business is now $99", quote: "Business plan: $99 per month" }],
    kind: "price",
    packKey: null,
    ...overrides,
  };
}

describe("assembleCards", () => {
  it("returns no cards for an empty week", () => {
    const cards = assembleCards([], PERIOD_END);

    expect(cards).toEqual([]);
  });

  it("puts urgent events first, then the most relevant", () => {
    const cards = assembleCards(
      [
        event({ id: "low", relevanceScore: 0.6 }),
        event({ id: "high", relevanceScore: 0.9 }),
        event({ id: "urgent", relevanceScore: 0.5, isUrgent: true }),
      ],
      PERIOD_END,
    );

    expect(cards.map((card) => card.eventId)).toEqual(["urgent", "high", "low"]);
  });

  it("gives a card its age in whole days at the end of the window", () => {
    const [card] = assembleCards([event()], PERIOD_END);

    expect(card?.ageDays).toBe(3);
  });

  it("keeps fact, implication and interpretation as separate blocks", () => {
    const [card] = assembleCards(
      [
        event({
          implication: "Your plan is now the cheaper one.",
          interpretation: "Likely margin pressure.",
        }),
      ],
      PERIOD_END,
    );

    expect(card?.blocks.map((block) => block.kind)).toEqual([
      "fact",
      "implication",
      "model_interpretation",
    ]);
  });

  it("does not group seven events", () => {
    const events = Array.from({ length: 7 }, (_, index) =>
      event({ id: `e${index}`, targetId: "fathom", targetName: "Fathom" }),
    );

    const cards = assembleCards(events, PERIOD_END);

    expect(cards).toHaveLength(7);
  });

  it("folds events about one target into one card past seven", () => {
    const events = [
      ...Array.from({ length: 5 }, (_, index) =>
        event({
          id: `f${index}`,
          targetId: "fathom",
          targetName: "Fathom",
          relevanceScore: 0.9 - index / 100,
        }),
      ),
      event({ id: "s1", targetId: "stripe", targetName: "Stripe" }),
      event({ id: "n1" }),
      event({ id: "n2" }),
    ];

    const cards = assembleCards(events, PERIOD_END);

    const group = cards.find((card) => card.kind === "group");
    expect(cards).toHaveLength(4);
    expect(group).toMatchObject({ headline: "Fathom", moreCount: 2 });
    expect(group?.blocks).toHaveLength(3);
  });

  it("never folds an urgent event into a group", () => {
    const events = [
      event({ id: "urgent", targetId: "fathom", targetName: "Fathom", isUrgent: true }),
      ...Array.from({ length: 7 }, (_, index) =>
        event({ id: `f${index}`, targetId: "fathom", targetName: "Fathom" }),
      ),
    ];

    const cards = assembleCards(events, PERIOD_END);

    expect(cards[0]).toMatchObject({ kind: "event", eventId: "urgent" });
  });
});

describe("linkToQuote", () => {
  it("appends a text fragment of the quote", () => {
    const link = linkToQuote("https://usefathom.com/pricing", "Business plan: $99 per month");

    expect(link).toBe(
      "https://usefathom.com/pricing#:~:text=Business%20plan%3A%20%2499%20per%20month",
    );
  });

  it("escapes dashes, which delimit a text directive", () => {
    const link = linkToQuote("https://example.com/", "pay-as-you-go pricing");

    expect(link).toContain("pay%2Das%2Dyou%2Dgo");
  });

  it("cuts a long quote at a word boundary", () => {
    const quote = "The quick brown fox jumps over the lazy dog and keeps running far away";

    const link = linkToQuote("https://example.com/", quote);

    expect(decodeURIComponent(link?.split("#:~:text=")[1] ?? "")).toBe(
      "The quick brown fox jumps over the lazy dog and keeps",
    );
  });

  it("gives no link when the source address is unsafe", () => {
    const link = linkToQuote("javascript:alert(1)", "Business plan: $99 per month");

    expect(link).toBeNull();
  });
});

describe("the market & rules section", () => {
  function packEvent(id: string, kind: string, day: number): EventForCard {
    return event({
      id,
      kind,
      packKey: "ru.regulators.fns",
      occurredAt: new Date(`2026-09-${String(day).padStart(2, "0")}T08:00:00Z`),
    });
  }

  it("puts pack material after the profile's own cards, never mixed in", () => {
    const cards = assembleCards(
      [packEvent("rule", "market_rule", 20), event({ id: "own-1" }), event({ id: "own-2" })],
      PERIOD_END,
    );

    expect(cards.map((card) => card.section)).toEqual(["main", "main", "market"]);
  });

  it("keeps the section to its limit, rules first and the freshest first within a kind", () => {
    const own = [event({ id: "own-1" }), event({ id: "own-2" }), event({ id: "own-3" })];
    const pack = [
      packEvent("news-old", "market_news", 10),
      packEvent("news-new", "market_news", 24),
      packEvent("platform-1", "platform", 15),
      packEvent("rule-old", "market_rule", 11),
      packEvent("rule-new", "market_rule", 23),
      packEvent("platform-2", "platform", 22),
      packEvent("news-mid", "market_news", 18),
      packEvent("news-x", "market_news", 12),
    ];

    const market = assembleCards([...own, ...pack], PERIOD_END).filter(
      (card) => card.section === "market",
    );

    expect(market).toHaveLength(MARKET_SECTION_LIMIT);
    expect(market.map((card) => card.eventId)).toEqual([
      "rule-new",
      "rule-old",
      "platform-2",
      "platform-1",
      "news-new",
      "news-mid",
    ]);
  });

  it("does not fold pack material into a group card", () => {
    const pack = Array.from({ length: 9 }, (_, index) =>
      packEvent(`rule-${index}`, "market_rule", 10 + index),
    );

    const cards = assembleCards(pack, PERIOD_END);

    expect(cards.every((card) => card.kind === "event")).toBe(true);
  });
});
