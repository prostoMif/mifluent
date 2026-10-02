import type { DigestView } from "@mifluent/digest";
import { describe, expect, it } from "vitest";
import { renderEmailDigest } from "./render.js";

const options = {
  appUrl: "https://mifluent.example",
  timezone: "UTC",
  feedbackEmail: "founder@mifluent.example",
  actionUrl: (cardId: string, action: string) => `https://mifluent.example/a/${cardId}.${action}`,
  unsubscribeUrl: "https://mifluent.example/unsubscribe/token",
};

const card = {
  id: "c1",
  eventId: "e1",
  targetId: "t1",
  kind: "event" as const,
  headline: "Fathom raised Business to $99",
  sourceUrl: "https://usefathom.com/pricing",
  ageDays: 1,
  moreCount: 0,
  isUrgent: false,
  targetKind: null,
  section: "main" as const,
  eventKind: "price",
  blocks: [
    {
      kind: "fact" as const,
      content: "Business is now $99 a month",
      quote: "Business plan: $99 per month",
      sourceUrl: "https://usefathom.com/pricing",
    },
  ],
};

function digest(overrides: Partial<DigestView> = {}): DigestView {
  return {
    id: "d1",
    tenantId: "t1",
    profileId: "p1",
    profileName: "Analytics SaaS",
    language: "en",
    periodStart: new Date("2026-09-27T08:00:00Z"),
    periodEnd: new Date("2026-09-28T08:00:00Z"),
    isUrgent: false,
    status: "pending",
    channel: "email",
    telegramChatId: null,
    sourcesChecked: 34,
    itemsConsidered: 210,
    nearMisses: [],
    notices: [],
    cards: [card, { ...card, id: "c2", headline: "Plausible added a free tier" }],
    profileCreatedAt: new Date("2026-01-01T00:00:00Z"),
    failureReason: null,
    ...overrides,
  };
}

describe("the digest email", () => {
  it("names the top change in the subject, not the fact that an email came", () => {
    expect(renderEmailDigest(digest(), options).subject).toBe(
      "Fathom raised Business to $99 + 1 more — Analytics SaaS",
    );
    expect(renderEmailDigest(digest({ cards: [] }), options).subject).toBe(
      "Quiet: 34 sources checked — Analytics SaaS",
    );
    expect(renderEmailDigest(digest({ language: "ru", cards: [] }), options).subject).toBe(
      "Тихо: проверено 34 источника — Analytics SaaS",
    );
  });

  it("is a whole document that declares dark mode, with a preview line", () => {
    const { html } = renderEmailDigest(digest(), options);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("Fathom raised Business to $99 · Plausible added a free tier");
    expect(html.trim().endsWith("</html>")).toBe(true);
  });

  it("uses signed action links and the unsubscribe link, in both versions", () => {
    const { html, text } = renderEmailDigest(digest(), options);
    expect(html).toContain("https://mifluent.example/a/c1.saved");
    expect(text).toContain("https://mifluent.example/a/c1.saved");
    expect(html).toContain("https://mifluent.example/unsubscribe/token");
    expect(text).toContain("Unsubscribe: https://mifluent.example/unsubscribe/token");
  });

  it("writes the footer in Russian for a Russian profile", () => {
    const { html, text } = renderEmailDigest(digest({ language: "ru" }), options);
    expect(html).toContain("Отписаться");
    expect(text).toContain("Ответь на это письмо");
  });
});
