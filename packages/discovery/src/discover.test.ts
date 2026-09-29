import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "@mifluent/llm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mifluent/sources", () => ({
  safeFetch: vi.fn(async () => {
    throw new Error("discovery must not reach the network in tests");
  }),
  htmlToText: (html: string) =>
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  parseFeed: vi.fn(),
}));

import { discover, normaliseWebsite } from "./discover.js";
import type { FetchedPage, Prober } from "./probe.js";
import { findTargetSurfaces, findTelegramChannels } from "./surfaces.js";

const competitorHome = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "competitor-home.html"),
  "utf-8",
);

const ownSite = `<html><body><h1>Plausible</h1><p>${"Simple, privacy-friendly analytics. ".repeat(20)}</p></body></html>`;

function fakeWeb(pages: Record<string, string>, feeds: readonly string[]): Prober {
  return {
    fetchPage: async (url): Promise<FetchedPage | null> => {
      const html = pages[url];
      return html === undefined
        ? null
        : {
            url,
            html,
            text: html
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          };
    },
    isFeed: async (url) => feeds.includes(url),
  };
}

function modelAnswering(answer: unknown) {
  return createLlmClient({
    baseUrl: "https://llm.example/v1",
    apiKey: "test",
    cheapModel: "cheap",
    deepModel: "deep",
    pricePerMillion: { cheapIn: 0, cheapOut: 0, deepIn: 0, deepOut: 0 },
    fetch: vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    ),
  });
}

const answer = {
  business: {
    name: "Plausible",
    description: "Privacy-friendly web analytics.",
    niche: "web analytics",
    monetization: "subscription",
    platforms: ["Stripe"],
    countries: ["EU"],
    customerType: "b2b",
    language: "en",
  },
  targets: [
    { kind: "competitor", name: "Fathom", websiteUrl: "usefathom.com", reason: "Same product." },
    { kind: "platform", name: "Stripe", websiteUrl: null, reason: "Takes payments." },
  ],
  conditions: [{ name: "GDPR", reason: "Consent rules decide what analytics may collect." }],
};

describe("discover", () => {
  it("asks for a description when the site is a business card", async () => {
    const prober = fakeWeb({ "https://tiny.example": "<p>Coming soon.</p>" }, []);

    const result = await discover({
      input: "https://tiny.example",
      language: "en",
      llm: modelAnswering(answer),
      userAgent: "test",
      prober,
    });

    expect(result.needsDescription).toBe(true);
    expect(result.targets).toEqual([]);
  });

  it("finds verified surfaces for a target from its homepage", async () => {
    const prober = fakeWeb(
      {
        "https://plausible.io": ownSite,
        "https://usefathom.com": competitorHome,
        "https://usefathom.com/pricing": `<p>${"Plans and prices. ".repeat(20)}</p>`,
        "https://api.lever.co/v0/postings/fathom": "[]",
      },
      ["https://usefathom.com/rss.xml", "https://status.usefathom.com/history.rss"],
    );

    const result = await discover({
      input: "https://plausible.io",
      language: "en",
      llm: modelAnswering(answer),
      userAgent: "test",
      prober,
    });

    const fathom = result.targets.find((target) => target.name === "Fathom");
    const verified = fathom?.surfaces
      .filter((surface) => surface.verified)
      .map((surface) => surface.label);
    expect(fathom?.websiteUrl).toBe("https://usefathom.com");
    expect(verified).toEqual(["Blog", "Pricing", "Jobs", "Status"]);
  });

  it("gives a target without a website only search surfaces", async () => {
    // Include Reddit feed URL so isFeed returns true for it.
    const redditUrl = `https://www.reddit.com/search.rss?q=${encodeURIComponent(`"Stripe"`)}&sort=new`;
    const prober = fakeWeb({}, [redditUrl]);

    const result = await discover({
      input: "We sell privacy-friendly analytics to small EU businesses.",
      language: "en",
      llm: modelAnswering(answer),
      userAgent: "test",
      prober,
    });

    const stripe = result.targets.find((target) => target.name === "Stripe");
    expect(stripe?.surfaces.map((surface) => surface.type)).toEqual(["query", "query"]);
  });

  it("proposes a news search for each condition", async () => {
    const prober = fakeWeb({}, []);

    const result = await discover({
      input: "We sell privacy-friendly analytics to small EU businesses.",
      language: "ru",
      llm: modelAnswering(answer),
      userAgent: "test",
      prober,
    });

    expect(result.conditions[0]?.surfaces[0]?.url).toContain("hl=ru");
  });

  it("finds Telegram channels from homepage links, ignores private invite links", async () => {
    // Need enough text content for readSite to not treat it as a business card (MIN_SITE_TEXT = 300).
    const homeHtml = `
      <html><body>
        <h1>Acme Corp</h1>
        <p>${"Acme Corp is a leading provider of innovative solutions. ".repeat(10)}</p>
        <a href="https://t.me/acme_news">Our channel</a>
        <a href="https://t.me/+abc123">Private group</a>
        <a href="https://t.me/joinchat/xyz">Join chat</a>
        <a href="https://telegram.me/another_channel">Another</a>
      </body></html>
    `;
    const rsshubUrlAcme = "http://rsshub:1200/telegram/channel/acme_news";
    const rsshubUrlAnother = "http://rsshub:1200/telegram/channel/another_channel";
    const isFeedCalls: string[] = [];
    const prober = {
      fetchPage: async (url: string) => {
        if (url === "https://example.com") {
          return {
            url,
            html: homeHtml,
            text: homeHtml
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          };
        }
        return null;
      },
      isFeed: async (url: string) => {
        isFeedCalls.push(url);
        return url === rsshubUrlAcme;
      },
    } as Prober;

    const answerWithTelegram = {
      ...answer,
      targets: [
        { kind: "competitor" as const, name: "Acme", websiteUrl: "example.com", reason: "Test." },
      ],
    };

    const result = await discover({
      input: "https://example.com",
      language: "ru",
      llm: modelAnswering(answerWithTelegram),
      userAgent: "test",
      prober,
    });

    const acme = result.targets.find((t) => t.name === "Acme");
    const telegramSurfaces = acme?.surfaces.filter((s) => s.label === "Telegram") ?? [];
    expect(telegramSurfaces).toHaveLength(1);
    expect(telegramSurfaces[0]?.url).toBe(rsshubUrlAcme);
    expect(isFeedCalls).toContain(rsshubUrlAcme);
    expect(isFeedCalls).toContain(rsshubUrlAnother);
  });

  it("Telegram channel extraction logic works correctly", async () => {
    // Direct test of the channel extraction logic
    const homeHtml = `
      <html><body>
        <a href="https://t.me/acme_news">Our channel</a>
        <a href="https://t.me/+abc123">Private group</a>
        <a href="https://t.me/joinchat/xyz">Join chat</a>
        <a href="https://telegram.me/another_channel">Another</a>
      </body></html>
    `;
    const pattern = /(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{5,32})(?![A-Za-z0-9_])/g;
    const channels = new Set<string>();
    for (const match of homeHtml.matchAll(pattern)) {
      const username = match[1];
      if (username && !username.startsWith("+") && username !== "joinchat") {
        channels.add(username.toLowerCase());
      }
    }
    expect(Array.from(channels)).toEqual(["acme_news", "another_channel"]);
  });

  it("findTargetSurfaces finds Telegram channels", async () => {
    const homeHtml = `
      <html><body>
        <a href="https://t.me/acme_news">Our channel</a>
        <a href="https://t.me/+abc123">Private group</a>
        <a href="https://t.me/joinchat/xyz">Join chat</a>
        <a href="https://telegram.me/another_channel">Another</a>
      </body></html>
    `;
    const rsshubUrlAcme = "http://rsshub:1200/telegram/channel/acme_news";
    const rsshubUrlAnother = "http://rsshub:1200/telegram/channel/another_channel";
    const isFeedCalls: string[] = [];
    const prober = {
      fetchPage: async (url: string) => {
        if (url === "https://example.com") {
          return {
            url,
            html: homeHtml,
            text: homeHtml
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          };
        }
        return null;
      },
      isFeed: async (url: string) => {
        isFeedCalls.push(url);
        return url === rsshubUrlAcme;
      },
    } as Prober;

    const surfaces = await findTargetSurfaces(
      { name: "Acme", websiteUrl: "https://example.com" },
      { prober, language: "ru" },
    );

    const telegramSurfaces = surfaces.filter((s) => s.label === "Telegram");
    expect(telegramSurfaces).toHaveLength(1);
    expect(telegramSurfaces[0]?.url).toBe(rsshubUrlAcme);
    expect(isFeedCalls).toContain(rsshubUrlAcme);
    expect(isFeedCalls).toContain(rsshubUrlAnother);
  });

  it("findTelegramChannels extracts channels correctly", async () => {
    const homeHtml = `
      <html><body>
        <a href="https://t.me/acme_news">Our channel</a>
        <a href="https://t.me/+abc123">Private group</a>
        <a href="https://t.me/joinchat/xyz">Join chat</a>
        <a href="https://telegram.me/another_channel">Another</a>
      </body></html>
    `;
    const rsshubUrlAcme = "http://rsshub:1200/telegram/channel/acme_news";
    const rsshubUrlAnother = "http://rsshub:1200/telegram/channel/another_channel";
    const isFeedCalledWith: string[] = [];
    const prober = {
      fetchPage: async (url: string) => {
        if (url === "https://example.com") {
          return {
            url,
            html: homeHtml,
            text: homeHtml
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          };
        }
        return null;
      },
      isFeed: async (url: string) => {
        isFeedCalledWith.push(url);
        return url === rsshubUrlAcme;
      },
    } as Prober;

    const home = {
      url: "https://example.com",
      html: homeHtml,
      text: homeHtml
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    };
    const surfaces = await findTelegramChannels(prober, home);

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.url).toBe(rsshubUrlAcme);
    expect(isFeedCalledWith).toContain(rsshubUrlAcme);
    expect(isFeedCalledWith).toContain(rsshubUrlAnother);
  });

  it("Telegram channel regex matches public channels only", () => {
    const html = `
      <a href="https://t.me/acme_news">Public</a>
      <a href="https://t.me/+abc123">Private</a>
      <a href="https://t.me/joinchat/xyz">Join</a>
      <a href="https://telegram.me/another_channel">Also public</a>
    `;
    // Use the same pattern as in surfaces.ts
    const pattern = /(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{5,32})(?![A-Za-z0-9_])/g;
    const matches = [...html.matchAll(pattern)];
    const usernames = matches
      .map((m) => m[1])
      .filter((u) => u && !u.startsWith("+") && u !== "joinchat");
    expect(usernames).toEqual(["acme_news", "another_channel"]);
  });

  it("uses model's newsQuery in Google News URL with proper encoding", async () => {
    // encodeURIComponent does not encode parentheses, so they remain as ( and ).
    const expectedUrl = `https://news.google.com/rss/search?q=%22Linear%22%20(issue%20tracker%20OR%20linear.app)&hl=en-US&gl=US&ceid=US:en`;
    const prober = fakeWeb({}, [expectedUrl]);

    const answerWithNewsQuery = {
      ...answer,
      targets: [
        {
          kind: "competitor" as const,
          name: "Linear",
          websiteUrl: null,
          reason: "Issue tracker.",
          newsQuery: '"Linear" (issue tracker OR linear.app)',
        },
      ],
    };

    const result = await discover({
      input: "We compete with Linear.",
      language: "en",
      llm: modelAnswering(answerWithNewsQuery),
      userAgent: "test",
      prober,
    });

    const linear = result.targets.find((t) => t.name === "Linear");
    const newsSurface = linear?.surfaces.find((s) => s.label === "Google News");
    expect(newsSurface?.url).toBe(expectedUrl);
  });

  it("falls back to quoted name when newsQuery is empty", async () => {
    const prober = fakeWeb({}, [
      "https://news.google.com/rss/search?q=%22Acme%22&hl=en-US&gl=US&ceid=US:en",
    ]);

    const answerWithoutNewsQuery = {
      ...answer,
      targets: [
        {
          kind: "competitor" as const,
          name: "Acme",
          websiteUrl: null,
          reason: "Test.",
          newsQuery: "",
        },
      ],
    };

    const result = await discover({
      input: "We compete with Acme.",
      language: "en",
      llm: modelAnswering(answerWithoutNewsQuery),
      userAgent: "test",
      prober,
    });

    const acme = result.targets.find((t) => t.name === "Acme");
    const newsSurface = acme?.surfaces.find((s) => s.label === "Google News");
    expect(newsSurface?.url).toContain("%22Acme%22");
  });
});

describe("normaliseWebsite", () => {
  it("adds a missing scheme", () => {
    expect(normaliseWebsite("usefathom.com")).toBe("https://usefathom.com");
  });

  it("drops something that is not a web address", () => {
    expect(normaliseWebsite("javascript:alert(1)")).toBeNull();
  });

  it("drops a host without a dot", () => {
    expect(normaliseWebsite("localhost")).toBeNull();
  });
});
