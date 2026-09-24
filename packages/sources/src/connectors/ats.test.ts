/**
 * Job-board connector tests. The fixtures follow the shape each provider's
 * public API actually returns (checked against live boards), trimmed to two or
 * three postings with invented details.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http/safe-fetch.js", () => ({ safeFetch: vi.fn() }));

import { safeFetch } from "../http/safe-fetch.js";
import { pollAtsBoard, readBoard } from "./ats.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const NOW = new Date("2026-01-20T12:00:00Z");
const USER_AGENT = "Mifluent/1.0 (test)";

function serve(body: Buffer | string, status = 200): void {
  vi.mocked(safeFetch).mockResolvedValue({
    status,
    isUnchanged: false,
    body: typeof body === "string" ? Buffer.from(body) : body,
    finalUrl: "https://api.example.com/",
    contentType: "application/json",
    etag: undefined,
    lastModifiedAt: undefined,
  });
}

function serveFixture(name: string): void {
  serve(readFileSync(join(fixtures, `${name}.json`)));
}

describe("readBoard", () => {
  it("reads the token from a board address", () => {
    const board = readBoard("https://jobs.lever.co/acme");

    expect(board).toEqual({ provider: "lever", token: "acme" });
  });

  it("reads the token from the API address discovery produces", () => {
    const board = readBoard("https://boards-api.greenhouse.io/v1/boards/acme/jobs");

    expect(board).toEqual({ provider: "greenhouse", token: "acme" });
  });

  it("accepts the newer Greenhouse board domain", () => {
    const board = readBoard("https://job-boards.greenhouse.io/acme");

    expect(board).toEqual({ provider: "greenhouse", token: "acme" });
  });

  it("refuses a host that merely contains a provider's name", () => {
    const read = (): unknown => readBoard("https://greenhouse.io.evil.example/acme");

    expect(read).toThrow(expect.objectContaining({ code: "source_unsupported" }));
  });

  it("refuses a board address without a token", () => {
    const read = (): unknown => readBoard("https://jobs.ashbyhq.com/");

    expect(read).toThrow(expect.objectContaining({ code: "source_unsupported" }));
  });
});

describe("pollAtsBoard", () => {
  beforeEach(() => {
    vi.mocked(safeFetch).mockReset();
  });

  it("fetches the API address it builds itself, not the one it was given", async () => {
    serveFixture("lever");

    await pollAtsBoard({ boardUrl: "https://jobs.lever.co/example", userAgent: USER_AGENT });

    expect(vi.mocked(safeFetch).mock.calls[0]?.[0].url).toBe(
      "https://api.lever.co/v0/postings/example?mode=json",
    );
  });

  it("reads Greenhouse postings, decoding the escaped HTML", async () => {
    serveFixture("greenhouse");

    const result = await pollAtsBoard({
      boardUrl: "https://boards.greenhouse.io/example",
      userAgent: USER_AGENT,
      now: NOW,
    });

    expect(result.items.map((item) => item.externalId)).toEqual(["gh-12345", "gh-12346"]);
    expect(result.items[0]).toMatchObject({
      title: "Senior Software Engineer",
      url: "https://job-boards.greenhouse.io/example/jobs/12345",
      publishedAt: new Date("2026-01-15T15:30:00Z"),
      metadata: {
        provider: "greenhouse",
        department: "Engineering",
        location: "San Francisco, CA",
      },
    });
    expect(result.items[0]?.content).toContain("TypeScript & Node.js");
    expect(result.items[0]?.content).not.toContain("&lt;");
    expect(result.items[0]?.content).not.toContain("<p>");
  });

  it("reads Lever postings, where the title is called text", async () => {
    serveFixture("lever");

    const result = await pollAtsBoard({
      boardUrl: "https://jobs.lever.co/example",
      userAgent: USER_AGENT,
      now: NOW,
    });

    expect(result.items[0]).toMatchObject({
      externalId: "lv-abc123",
      title: "Senior Software Engineer",
      publishedAt: new Date(1705312200000),
      metadata: { department: "Engineering", location: "San Francisco, CA" },
    });
    expect(result.items[0]?.content).toContain("Requirements: 5+ years experience.");
  });

  it("reads Ashby postings and skips unlisted ones", async () => {
    serveFixture("ashby");

    const result = await pollAtsBoard({
      boardUrl: "https://jobs.ashbyhq.com/example",
      userAgent: USER_AGENT,
      now: NOW,
    });

    expect(result.items.map((item) => item.title)).toEqual([
      "Senior Software Engineer",
      "Product Manager",
    ]);
  });

  it("names a closed posting by its title from the previous poll", async () => {
    serveFixture("greenhouse");

    const result = await pollAtsBoard({
      boardUrl: "https://boards.greenhouse.io/example",
      userAgent: USER_AGENT,
      previousJobs: [
        { id: "gh-12345", title: "Senior Software Engineer" },
        { id: "gh-99999", title: "Head of Payments" },
      ],
      now: NOW,
    });

    expect(result.closedItems).toHaveLength(1);
    expect(result.closedItems[0]).toMatchObject({
      externalId: "closed-gh-99999",
      title: "Closed: Head of Payments",
      url: null,
      metadata: { closed: true, originalExternalId: "gh-99999" },
    });
  });

  it("returns the current postings to remember for next time", async () => {
    serveFixture("lever");

    const result = await pollAtsBoard({
      boardUrl: "https://jobs.lever.co/example",
      userAgent: USER_AGENT,
    });

    expect(result.currentJobs).toEqual([
      { id: "lv-abc123", title: "Senior Software Engineer" },
      { id: "lv-def456", title: "Product Manager" },
    ]);
  });

  it("reports an error status as an unreachable source", async () => {
    serve("{}", 404);

    const poll = pollAtsBoard({
      boardUrl: "https://boards.greenhouse.io/example",
      userAgent: USER_AGENT,
    });

    await expect(poll).rejects.toMatchObject({ code: "source_unreachable" });
  });

  it("refuses an answer in an unexpected shape instead of guessing", async () => {
    serve(JSON.stringify({ postings: [] }));

    const poll = pollAtsBoard({
      boardUrl: "https://boards.greenhouse.io/example",
      userAgent: USER_AGENT,
    });

    await expect(poll).rejects.toMatchObject({ code: "source_unsupported" });
  });

  it("refuses an answer that is not JSON", async () => {
    serve("<html>Not found</html>");

    const poll = pollAtsBoard({ boardUrl: "https://jobs.lever.co/example", userAgent: USER_AGENT });

    await expect(poll).rejects.toMatchObject({ code: "source_unsupported" });
  });

  it("truncates a long description to 4000 characters", async () => {
    serve(
      JSON.stringify([
        { id: "long", text: "Long", descriptionPlain: "x".repeat(5_000), createdAt: 1 },
      ]),
    );

    const result = await pollAtsBoard({
      boardUrl: "https://jobs.lever.co/example",
      userAgent: USER_AGENT,
    });

    expect(result.items[0]?.content.length).toBe(4_000);
  });
});
