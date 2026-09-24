import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findAtsBoard,
  findFeedLinks,
  findGithubReleasesFeed,
  findInternalLinks,
  findStatusLink,
} from "./page-links.js";

const html = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "competitor-home.html"),
  "utf-8",
);
const BASE = "https://usefathom.com/";

describe("findFeedLinks", () => {
  it("finds an advertised feed whatever the attribute order", () => {
    const feeds = findFeedLinks(html, BASE);

    expect(feeds).toEqual(["https://usefathom.com/rss.xml"]);
  });

  it("ignores a stylesheet link", () => {
    const feeds = findFeedLinks('<link rel="stylesheet" href="/app.css">', BASE);

    expect(feeds).toEqual([]);
  });
});

describe("findInternalLinks", () => {
  it("keeps same-site links to the listed paths only", () => {
    const links = findInternalLinks(html, BASE, ["/pricing", "/about"]);

    expect(links).toEqual(["https://usefathom.com/pricing", "https://usefathom.com/about/"]);
  });
});

describe("findStatusLink", () => {
  it("finds a link whose text is Status", () => {
    const link = findStatusLink(html, BASE);

    expect(link).toBe("https://status.usefathom.com/");
  });
});

describe("findAtsBoard", () => {
  it("turns a Lever board link into the public API address", () => {
    const board = findAtsBoard(html);

    expect(board).toEqual({
      provider: "lever",
      token: "fathom",
      apiUrl: "https://api.lever.co/v0/postings/fathom",
    });
  });

  it("recognises the newer Greenhouse board domain", () => {
    const board = findAtsBoard('<a href="https://job-boards.greenhouse.io/acme">Jobs</a>');

    expect(board?.apiUrl).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs");
  });
});

describe("findGithubReleasesFeed", () => {
  it("builds the releases feed of a linked repository", () => {
    const feed = findGithubReleasesFeed(html);

    expect(feed).toBe("https://github.com/usefathom/fathom/releases.atom");
  });

  it("ignores a GitHub Sponsors link", () => {
    const feed = findGithubReleasesFeed(
      '<a href="https://github.com/sponsors/someone">Sponsor</a>',
    );

    expect(feed).toBeNull();
  });
});
