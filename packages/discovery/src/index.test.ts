/**
 * Tests for discovery.
 */

import { createLlmClient } from "@mifluent/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { discover } from "./index.js";

const emptyHtml = `<!DOCTYPE html>
<html>
<head><title>Empty Site</title></head>
<body><h1>Welcome</h1><p>Under construction.</p></body>
</html>`;

function createLlmMockFetch(responseBody: object) {
  return vi.fn(async () => {
    const response = new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    return response;
  });
}

function createClientWithFetchs(llmFetch: ReturnType<typeof vi.fn>) {
  return createLlmClient({
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    cheapModel: "gpt-4o-mini",
    deepModel: "gpt-4o",
    pricePerMillion: { cheapIn: 0, cheapOut: 0, deepIn: 0, deepOut: 0 },
    fetch: llmFetch,
  });
}

// Mock safeFetch for tests
vi.mock("@mifluent/sources", () => {
  return {
    safeFetch: vi.fn(),
    htmlToText: vi.fn((html: string) => html.replace(/<[^>]*>/g, "").trim()),
    parseFeed: vi.fn(),
    SafeFetchResult: {} as Record<string, unknown>,
  };
});

import { safeFetch } from "@mifluent/sources";

function setupSafeFetchMock(responses: Map<string, { html: string; status?: number }>) {
  (safeFetch as ReturnType<typeof vi.fn>).mockImplementation(
    async (options: { url: string; maxBytes?: number }) => {
      const key = Array.from(responses.keys()).find((k) => options.url.includes(k)) || "default";
      const response = responses.get(key) || responses.get("default");
      if (!response) {
        throw new Error(`No mock for ${options.url}`);
      }
      return {
        status: response.status ?? 200,
        finalUrl: options.url,
        body: Buffer.from(response.html, "utf-8"),
        contentType: "text/html",
        isUnchanged: false,
        etag: undefined,
        lastModifiedAt: undefined,
      };
    },
  );
}

describe("discover", () => {
  let llmFetch: ReturnType<typeof vi.fn>;
  let client: ReturnType<typeof createLlmClient>;

  beforeEach(() => {
    llmFetch = vi.fn();
    client = createClientWithFetchs(llmFetch);
    vi.clearAllMocks();
  });

  it("returns needs_description for short content", async () => {
    setupSafeFetchMock(new Map([["default", { html: emptyHtml }]]));

    const result = await discover({ input: "https://example.com", llm: client });
    expect(result.needsDescription).toBe(true);
  });

  it("extracts business info from text input", async () => {
    const llmResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              business: {
                name: "Test Analytics",
                description: "A test analytics platform for developers.",
                niche: "web analytics",
                monetization: "subscription",
                platforms: ["AWS", "Vercel"],
                countries: ["US", "EU"],
                customerType: "b2b",
                language: "en",
              },
              targets: [
                {
                  kind: "competitor",
                  name: "Google Analytics",
                  websiteUrl: "https://analytics.google.com",
                  reason: "Dominant market leader",
                },
                {
                  kind: "platform",
                  name: "AWS",
                  websiteUrl: "https://aws.amazon.com",
                  reason: "Hosting infrastructure",
                },
              ],
              conditions: [{ name: "GDPR changes", reason: "Impacts data collection" }],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };

    llmFetch = createLlmMockFetch(llmResponse);
    client = createClientWithFetchs(llmFetch);

    const result = await discover({
      input: "Test Analytics is a privacy-first analytics tool for developers.",
      llm: client,
    });

    expect(result.business.name).toBe("Test Analytics");
    expect(result.targets.length).toBe(2);
    expect(result.conditions.length).toBe(1);
  });
});

describe("DiscoveryResult schema", () => {
  it("validates correct result structure", () => {
    const schema = z.object({
      business: z.object({
        name: z.string(),
        description: z.string(),
        niche: z.string(),
        monetization: z.enum(["free", "trial", "subscription", "one_time", "unknown"]),
        platforms: z.array(z.string()),
        countries: z.array(z.string()),
        customerType: z.string(),
        language: z.enum(["en", "ru"]),
      }),
      targets: z.array(
        z.object({
          kind: z.enum(["competitor", "platform", "condition"]),
          name: z.string(),
          websiteUrl: z.string().url().nullable(),
          reason: z.string(),
          surfaces: z.array(
            z.object({
              type: z.enum(["feed", "diff", "json", "query"]),
              url: z.string().url(),
              label: z.string(),
              pollIntervalMinutes: z.number().int().positive(),
              verified: z.boolean(),
            }),
          ),
        }),
      ),
      conditions: z.array(
        z.object({
          name: z.string(),
          reason: z.string(),
          surfaces: z.array(
            z.object({
              type: z.enum(["feed", "diff", "json", "query"]),
              url: z.string().url(),
              label: z.string(),
              pollIntervalMinutes: z.number().int().positive(),
              verified: z.boolean(),
            }),
          ),
        }),
      ),
      needsDescription: z.boolean().optional(),
    });

    const validResult = {
      business: {
        name: "Test",
        description: "Test description",
        niche: "test",
        monetization: "subscription" as const,
        platforms: [],
        countries: [],
        customerType: "b2b",
        language: "en" as const,
      },
      targets: [],
      conditions: [],
    };

    const result = schema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it("rejects invalid monetization value", () => {
    const schema = z.object({
      business: z.object({
        name: z.string(),
        description: z.string(),
        niche: z.string(),
        monetization: z.enum(["free", "trial", "subscription", "one_time", "unknown"]),
        platforms: z.array(z.string()),
        countries: z.array(z.string()),
        customerType: z.string(),
        language: z.enum(["en", "ru"]),
      }),
      targets: z.array(z.any()),
      conditions: z.array(z.any()),
    });

    const invalidResult = {
      business: {
        name: "Test",
        description: "Test",
        niche: "test",
        monetization: "invalid",
        platforms: [],
        countries: [],
        customerType: "b2b",
        language: "en",
      },
      targets: [],
      conditions: [],
    };

    const result = schema.safeParse(invalidResult);
    expect(result.success).toBe(false);
  });
});

describe("URL building", () => {
  it("builds correct Google News query URL", () => {
    const name = "Test Company";
    const encoded = encodeURIComponent(`"${name}"`);
    const expected = `https://news.google.com/rss/search?q=${encoded}&hl=en`;
    expect(expected).toContain("news.google.com");
    expect(expected).toContain("Test%20Company");
  });

  it("builds correct Reddit query URL", () => {
    const name = "Test Company";
    const encoded = encodeURIComponent(`"${name}"`);
    const expected = `https://www.reddit.com/search.rss?q=${encoded}&sort=new`;
    expect(expected).toContain("reddit.com");
    expect(expected).toContain("Test%20Company");
  });
});
