import { describe, expect, it } from "vitest";
import {
  composeTelegramPost,
  composeWeeklyPost,
  composeXPost,
  TELEGRAM_POST_LIMIT,
  X_POST_LIMIT,
  xLength,
} from "./radar-posts.js";

const base = {
  language: "en",
  company: "Notion",
  summary: "raised the Plus plan from $10 to $12 per seat",
  quote: "Plus is now $12 per seat per month, billed annually.",
  sourceUrl: "https://www.notion.so/pricing",
  pageUrl: "https://mifluent.com/changes/notion",
  ctaUrl: "https://mifluent.com",
} as const;

describe("radar posts", () => {
  it("puts the fact, the quote, the source, our page and the call to action in the post", () => {
    const post = composeTelegramPost(base);
    expect(post).toContain("Notion: raised the Plus plan");
    expect(post).toContain("«Plus is now $12");
    expect(post).toContain("Source: https://www.notion.so/pricing");
    expect(post).toContain("Full history: https://mifluent.com/changes/notion");
    expect(post.split("\n").at(-1)).toBe(
      "Want this for your own competitors → https://mifluent.com",
    );
  });

  it("keeps a Telegram post within 4 096 characters by trimming the quote, not the links", () => {
    const post = composeTelegramPost({ ...base, quote: "word ".repeat(2_000) });
    expect(post.length).toBeLessThanOrEqual(TELEGRAM_POST_LIMIT);
    expect(post).toContain("https://www.notion.so/pricing");
  });

  it("keeps the X version within 280 as X counts it", () => {
    for (const quote of [base.quote, "long ".repeat(200), null]) {
      const post = composeXPost({ ...base, quote, summary: "changed ".repeat(40) });
      expect(xLength(post)).toBeLessThanOrEqual(X_POST_LIMIT);
      expect(post).toContain("https://www.notion.so/pricing");
    }
  });

  it("writes Russian posts in Russian", () => {
    const post = composeTelegramPost({
      ...base,
      language: "ru",
      ctaUrl: "https://t.me/mifluent_bot",
    });
    expect(post).toContain("Источник:");
    expect(post).toContain("Хочешь такое про своих конкурентов → https://t.me/mifluent_bot");
  });

  it("keeps the weekly round-up within the Telegram limit", () => {
    const items = Array.from({ length: 200 }, (_, index) => ({
      company: `Company ${index}`,
      summary: "changed something rather long ".repeat(3),
      pageUrl: `https://mifluent.com/changes/company-${index}`,
    }));
    expect(composeWeeklyPost("en", items, base.ctaUrl).length).toBeLessThanOrEqual(
      TELEGRAM_POST_LIMIT,
    );
  });
});
