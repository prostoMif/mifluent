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
    const prober = fakeWeb({}, []);

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
