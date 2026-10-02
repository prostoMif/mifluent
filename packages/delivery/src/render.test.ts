import type { DigestView } from "@mifluent/digest";
import { describe, expect, it } from "vitest";
import { renderDigest } from "./render.js";
import { MAX_MESSAGE_LENGTH } from "./telegram-api.js";

const options = { appUrl: "https://mifluent.example", timezone: "UTC" };

function digest(overrides: Partial<DigestView> = {}): DigestView {
  return {
    id: "d1",
    tenantId: "t1",
    profileId: "p1",
    profileName: "Analytics SaaS",
    language: "en",
    periodStart: new Date("2026-09-21T08:00:00Z"),
    periodEnd: new Date("2026-09-28T08:00:00Z"),
    isUrgent: false,
    status: "pending",
    channel: "telegram",
    telegramChatId: "42",
    sourcesChecked: 12,
    itemsConsidered: 214,
    nearMisses: [],
    notices: [],
    cards: [],
    profileCreatedAt: new Date("2026-09-20T08:00:00Z"),
    failureReason: null,
    ...overrides,
  };
}

const card = {
  id: "c1",
  eventId: "e1",
  targetId: "t1",
  kind: "event" as const,
  headline: "Fathom raised Business to $99",
  sourceUrl: "https://usefathom.com/pricing",
  ageDays: 3,
  moreCount: 0,
  isUrgent: false,
  targetKind: null,
  section: "main" as const,
  eventKind: "price" as string | null,
  blocks: [
    {
      kind: "fact" as const,
      content: "Business is now $99 a month",
      quote: "Business plan: $99 per month",
      sourceUrl: "https://usefathom.com/pricing#:~:text=Business",
    },
    {
      kind: "implication" as const,
      content: "You are now $20 cheaper.",
      quote: null,
      sourceUrl: null,
    },
  ],
};

describe("renderDigest", () => {
  it("reports an empty week with what was checked and the closest misses", () => {
    const [header] = renderDigest(
      digest({
        nearMisses: [
          { title: "Stripe raises fees", url: "https://stripe.com/blog", reason: "below_cosine" },
        ],
      }),
      options,
    );

    expect(header?.text).toContain("Checked 12 sources, 214 items.");
    expect(header?.text).toContain("too far from what you watch");
  });

  it("escapes source text so it cannot become markup", () => {
    const [, rendered] = renderDigest(
      digest({ cards: [{ ...card, headline: '<a href="https://evil.example">Win</a> & more' }] }),
      options,
    );

    expect(rendered?.text).toContain(
      "&lt;a href=&quot;https://evil.example&quot;&gt;Win&lt;/a&gt; &amp; more",
    );
    expect(rendered?.text).not.toContain('<a href="https://evil.example">');
  });

  it("puts the four feedback buttons under each card", () => {
    const [, rendered] = renderDigest(digest({ cards: [card] }), options);

    expect(
      rendered?.buttons?.map((button) => (button.type === "callback" ? button.callbackData : "")),
    ).toEqual(["not_following_target:c1", "not_important:c1", "saved:c1", "influenced:c1"]);
  });

  it("writes the Russian frame for a Russian profile", () => {
    const [header] = renderDigest(digest({ language: "ru" }), options);

    expect(header?.text).toContain("Тихо за");
    expect(header?.text).toContain("Проверено 12 источников, 214 материалов.");
  });

  it("keeps an oversized card under Telegram's limit", () => {
    const long = {
      kind: "fact" as const,
      content: "x".repeat(1_500),
      quote: null,
      sourceUrl: null,
    };
    const [, rendered] = renderDigest(
      digest({ cards: [{ ...card, blocks: [long, long, long, long] }] }),
      options,
    );

    expect(rendered?.text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  });

  it("names the count on a folded card and links to the rest", () => {
    const [, rendered] = renderDigest(
      digest({ cards: [{ ...card, kind: "group", headline: "Fathom", moreCount: 2 }] }),
      options,
    );

    expect(rendered?.text).toContain("Fathom: 4 changes");
    expect(rendered?.text).toContain('href="https://mifluent.example/today"');
  });

  it("states the cost-cap pause rather than staying silent", () => {
    const [header] = renderDigest(digest({ notices: [{ code: "cost_cap_reached" }] }), options);

    expect(header?.text).toContain("Processing is paused until tomorrow");
  });
});

describe("the brief's frame", () => {
  it("links the near misses instead of printing their markup", () => {
    const [header] = renderDigest(
      digest({
        profileCreatedAt: new Date("2026-01-01T00:00:00Z"),
        nearMisses: [{ title: "Fees", url: "https://stripe.com/blog", reason: "below_cosine" }],
      }),
      options,
    );

    expect(header?.text).toContain('<a href="https://stripe.com/blog">Fees</a>');
    expect(header?.text).not.toContain("&lt;a");
  });

  it("sums the day up under the title", () => {
    const rule = { ...card, id: "c2", section: "market" as const, eventKind: "market_rule" };
    const [en] = renderDigest(digest({ cards: [card, rule] }), options);
    const [ru] = renderDigest(digest({ language: "ru", cards: [card, card, rule] }), options);

    expect(en?.text).toContain("1 change at 1 company · 1 about your market &amp; rules");
    expect(ru?.text).toContain("2 изменения у 1 компании · 1 по рынку и правилам");
  });

  it("marks the kind of change and keeps the history link in one footer line", () => {
    const [, rendered] = renderDigest(digest({ cards: [card] }), options);

    expect(
      rendered?.text.startsWith("💰 <b>Fathom raised Business to $99</b> · <i>3 days ago</i>"),
    ).toBe(true);
    expect(rendered?.text).toContain('href="https://mifluent.example/targets/t1">history</a>');
  });

  it("matches the English and Russian layouts", () => {
    expect(renderDigest(digest({ cards: [card] }), options)).toMatchSnapshot();
    expect(renderDigest(digest({ language: "ru", cards: [card] }), options)).toMatchSnapshot();
    expect(renderDigest(digest({ isUrgent: true, cards: [card] }), options)).toMatchSnapshot();
    expect(renderDigest(digest({ language: "ru" }), options)).toMatchSnapshot();
  });

  it("keeps every button's data within Telegram's 64 bytes", () => {
    const uuidCard = { ...card, id: "0192f0c4-1234-7abc-8def-0123456789ab" };
    const [, rendered] = renderDigest(digest({ cards: [uuidCard] }), options);
    for (const button of rendered?.buttons ?? []) {
      if (button.type === "callback") {
        expect(Buffer.byteLength(button.callbackData)).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("the market & rules section", () => {
  const ruleCard = {
    ...card,
    id: "c-rule",
    headline: "ФНС меняет порог УСН",
    section: "market" as const,
  };

  it("puts one heading before the first pack card, in the reader's language", () => {
    const messages = renderDigest(
      digest({ language: "ru", cards: [card, ruleCard, ruleCard] }),
      options,
    );

    const positions = messages.flatMap((message, index) =>
      message.text === "<b>В твоей стране и нише</b>" ? [index] : [],
    );
    expect(positions).toEqual([2]);
  });

  it("titles the section in English for an English profile", () => {
    const messages = renderDigest(digest({ cards: [ruleCard] }), options);

    expect(messages.some((message) => message.text === "<b>Your market &amp; rules</b>")).toBe(
      true,
    );
  });

  it("adds no heading when there is no pack material", () => {
    const messages = renderDigest(digest({ cards: [card] }), options);

    expect(messages.some((message) => message.text.includes("Your market"))).toBe(false);
  });
});
