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
    ...overrides,
  };
}

const card = {
  id: "c1",
  eventId: "e1",
  kind: "event" as const,
  headline: "Fathom raised Business to $99",
  sourceUrl: "https://usefathom.com/pricing",
  ageDays: 3,
  moreCount: 0,
  isUrgent: false,
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

  it("puts the three feedback buttons under each card", () => {
    const [, rendered] = renderDigest(digest({ cards: [card] }), options);

    expect(rendered?.buttons?.map((button) => button.callbackData)).toEqual([
      "not_following_target:c1",
      "not_important:c1",
      "saved:c1",
    ]);
  });

  it("writes the Russian frame for a Russian profile", () => {
    const [header] = renderDigest(digest({ language: "ru" }), options);

    expect(header?.text).toContain("Ничего, что тебя касается");
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
