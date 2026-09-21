import { describe, expect, it } from "vitest";
import { canonicaliseUrl, type FingerprintInput, fingerprintItem } from "./identity.js";

function item(overrides: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
    externalId: null,
    url: null,
    title: null,
    content: null,
    feedUrl: "https://acme.example/feed.xml",
    ...overrides,
  };
}

describe("canonicaliseUrl", () => {
  it("removes campaign parameters", () => {
    expect(canonicaliseUrl("https://acme.example/post?utm_source=x&utm_medium=y")).toBe(
      "https://acme.example/post",
    );
  });

  it("removes the click identifiers the big platforms add", () => {
    expect(canonicaliseUrl("https://acme.example/post?fbclid=abc&gclid=def")).toBe(
      "https://acme.example/post",
    );
  });

  it("keeps parameters that mean something", () => {
    // The cost of dropping one of these is an article nobody ever sees.
    expect(canonicaliseUrl("https://acme.example/post?id=42&page=2")).toBe(
      "https://acme.example/post?id=42&page=2",
    );
  });

  it("keeps a meaningful parameter while removing a tracking one beside it", () => {
    expect(canonicaliseUrl("https://acme.example/post?id=42&utm_source=news")).toBe(
      "https://acme.example/post?id=42",
    );
  });

  it("drops the fragment", () => {
    expect(canonicaliseUrl("https://acme.example/post#section-3")).toBe(
      "https://acme.example/post",
    );
  });

  it("drops a trailing slash but not the root one", () => {
    expect(canonicaliseUrl("https://acme.example/post/")).toBe("https://acme.example/post");
    expect(canonicaliseUrl("https://acme.example/")).toBe("https://acme.example/");
  });

  it("lowercases the host but not the path", () => {
    // Hosts are case-insensitive; paths are not, and lowercasing one would
    // merge two different pages.
    expect(canonicaliseUrl("https://ACME.example/Post")).toBe("https://acme.example/Post");
  });

  it("returns something unparseable unchanged rather than throwing", () => {
    expect(canonicaliseUrl("  not a url  ")).toBe("not a url");
  });
});

describe("fingerprintItem", () => {
  it("gives the same fingerprint to the same article from two feeds", () => {
    // The case this whole file exists for: a press release arriving by three
    // routes should appear in the digest once.
    const fromBlog = fingerprintItem(
      item({ url: "https://acme.example/news/1", feedUrl: "https://acme.example/feed.xml" }),
    );
    const fromAggregator = fingerprintItem(
      item({
        url: "https://acme.example/news/1?utm_source=aggregator",
        feedUrl: "https://aggregator.example/rss",
      }),
    );

    expect(fromBlog).toBe(fromAggregator);
  });

  it("gives different fingerprints to different articles", () => {
    const first = fingerprintItem(item({ url: "https://acme.example/news/1" }));
    const second = fingerprintItem(item({ url: "https://acme.example/news/2" }));

    expect(first).not.toBe(second);
  });

  it("scopes a publisher identifier to the feed it came from", () => {
    // "post-1" is unique inside one blog and meaningless outside it. Two blogs
    // both numbering from one must not collapse into a single item.
    const first = fingerprintItem(
      item({ externalId: "post-1", feedUrl: "https://one.example/feed" }),
    );
    const second = fingerprintItem(
      item({ externalId: "post-1", feedUrl: "https://two.example/feed" }),
    );

    expect(first).not.toBe(second);
  });

  it("prefers the address over the publisher identifier", () => {
    // Two feeds give the same article different guids. The address is what
    // they agree on.
    const first = fingerprintItem(item({ url: "https://acme.example/1", externalId: "a" }));
    const second = fingerprintItem(item({ url: "https://acme.example/1", externalId: "b" }));

    expect(first).toBe(second);
  });

  it("falls back to the text when there is no address and no identifier", () => {
    const first = fingerprintItem(item({ title: "Same", content: "Body" }));
    const second = fingerprintItem(item({ title: "Same", content: "Body" }));
    const third = fingerprintItem(item({ title: "Different", content: "Body" }));

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("produces a hex digest of the expected length", () => {
    expect(fingerprintItem(item({ url: "https://acme.example/1" }))).toMatch(/^[0-9a-f]{64}$/);
  });
});
