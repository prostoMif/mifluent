import { isAppError } from "@mifluent/core";
import { describe, expect, it } from "vitest";
import { parseFeed } from "./parse-feed.js";

const FEED_URL = "https://example.com/feed.xml";

function parse(xml: string, contentType?: string) {
  return parseFeed({
    body: Buffer.from(xml, "utf8"),
    feedUrl: FEED_URL,
    ...(contentType === undefined ? {} : { contentType }),
    now: new Date("2026-08-18T12:00:00Z"),
  });
}

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Acme Blog</title>
    <link>https://acme.example/</link>
    <item>
      <title>We raised prices</title>
      <link>/posts/prices</link>
      <guid isPermaLink="false">post-1</guid>
      <description>A short teaser.</description>
      <content:encoded>The whole article.</content:encoded>
      <dc:creator>Jo</dc:creator>
      <pubDate>Tue, 12 Aug 2026 09:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Acme Notes</title>
  <link rel="self" href="https://acme.example/feed.xml"/>
  <link rel="alternate" href="https://acme.example/"/>
  <entry>
    <id>tag:acme.example,2026:1</id>
    <title>A change</title>
    <link rel="replies" href="https://acme.example/comments/1"/>
    <link rel="alternate" href="https://acme.example/notes/1"/>
    <summary>Short.</summary>
    <content>Long.</content>
    <author><name>Sam</name></author>
    <published>2026-08-12T09:30:00Z</published>
    <updated>2026-08-13T10:00:00Z</updated>
  </entry>
</feed>`;

describe("parseFeed with RSS", () => {
  it("reads the channel title and site address", () => {
    const feed = parse(RSS);

    expect(feed.title).toBe("Acme Blog");
    expect(feed.siteUrl).toBe("https://acme.example/");
  });

  it("resolves a relative item link against the feed address", () => {
    // Feeds do this constantly, and a relative link stored as-is is a link
    // that goes nowhere from an email or a Telegram message.
    expect(parse(RSS).items[0]?.url).toBe("https://example.com/posts/prices");
  });

  it("reads the identifier out of a guid that carries attributes", () => {
    expect(parse(RSS).items[0]?.externalId).toBe("post-1");
  });

  it("prefers the full article over the teaser", () => {
    const item = parse(RSS).items[0];

    expect(item?.content).toBe("The whole article.");
    expect(item?.summary).toBe("A short teaser.");
  });

  it("reads the author from the Dublin Core element", () => {
    expect(parse(RSS).items[0]?.author).toBe("Jo");
  });

  it("reads an RFC 822 date", () => {
    expect(parse(RSS).items[0]?.publishedAt?.toISOString()).toBe("2026-08-12T09:30:00.000Z");
  });
});

describe("parseFeed with Atom", () => {
  it("takes the alternate link, not the first one", () => {
    // The first link here is the comment thread. A reader that took links in
    // order would send people to the comments.
    expect(parse(ATOM).items[0]?.url).toBe("https://acme.example/notes/1");
  });

  it("takes the site address from the alternate link, not from self", () => {
    expect(parse(ATOM).siteUrl).toBe("https://acme.example/");
  });

  it("prefers published over updated", () => {
    expect(parse(ATOM).items[0]?.publishedAt?.toISOString()).toBe("2026-08-12T09:30:00.000Z");
  });

  it("reads a nested author name", () => {
    expect(parse(ATOM).items[0]?.author).toBe("Sam");
  });
});

describe("parseFeed with RSS 1.0", () => {
  it("reads items that sit beside the channel rather than inside it", () => {
    const rdf = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns="http://purl.org/rss/1.0/">
        <channel><title>Old School</title><link>https://old.example/</link></channel>
        <item><title>Still here</title><link>https://old.example/1</link></item>
      </rdf:RDF>`;

    const feed = parse(rdf);

    expect(feed.title).toBe("Old School");
    expect(feed.items).toHaveLength(1);
  });
});

describe("parseFeed resilience", () => {
  it("keeps the good items when one is empty", () => {
    // The whole point: one broken item must not cost the other forty.
    const xml = `<rss version="2.0"><channel>
      <title>Mixed</title>
      <item></item>
      <item><title>Real one</title><link>https://acme.example/1</link></item>
    </channel></rss>`;

    const items = parse(xml).items;

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Real one");
  });

  it("keeps an item whose date cannot be read, without a date", () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>Undated</title><pubDate>last tuesday probably</pubDate>
    </item></channel></rss>`;

    const item = parse(xml).items[0];

    expect(item?.title).toBe("Undated");
    expect(item?.publishedAt).toBeNull();
  });

  it("decodes the character references XML actually defines", () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>Tom &amp; Jerry &#171;quoted&#187;</title>
    </item></channel></rss>`;

    expect(parse(xml).items[0]?.title).toBe("Tom & Jerry «quoted»");
  });

  it("reads the HTML references publishers actually put in titles", () => {
    const xml = `<rss version="2.0"><channel><item><title>a&nbsp;b</title></item></channel></rss>`;

    expect(parse(xml).items[0]?.title).toBe("a b");
  });

  it("leaves an entity nobody defines rather than guessing at it", () => {
    const xml = `<rss version="2.0"><channel><item><title>a&fnof;b</title></item></channel></rss>`;

    expect(parse(xml).items[0]?.title).toBe("a&fnof;b");
  });

  it("strips markup out of item text", () => {
    // The schema stores text, never markup. Doing it here means nothing
    // downstream has to remember.
    const xml = `<rss version="2.0"><channel><item>
      <title>Tagged</title>
      <description>&lt;p&gt;Hello &lt;b&gt;there&lt;/b&gt;&lt;/p&gt;</description>
    </item></channel></rss>`;

    expect(parse(xml).items[0]?.summary).toBe("Hello there");
  });

  it("refuses a document that is not a feed", () => {
    try {
      parse("<html><body>Not a feed</body></html>");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("source_unsupported");
    }
  });

  it("refuses an empty response", () => {
    try {
      parse("");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("source_unsupported");
    }
  });
});

describe("parseFeed and entity expansion", () => {
  it("does not expand a declared entity", () => {
    /*
     * The first stage of a "billion laughs" attack. If the parser expanded
     * entities, this would be the point where a few kilobytes started turning
     * into gigabytes. The title is expected to come back with the reference
     * untouched.
     */
    const xml = `<?xml version="1.0"?>
      <!DOCTYPE rss [
        <!ENTITY lol "haha">
        <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
      ]>
      <rss version="2.0"><channel><item><title>&lol2;</title></item></channel></rss>`;

    const title = parse(xml).items[0]?.title ?? "";

    expect(title).not.toContain("haha");
  });
});

describe("parseFeed and character encodings", () => {
  it("reads a feed declared as windows-1251", () => {
    // Still common on older Russian and Ukrainian blogs. Read as UTF-8 it
    // becomes a line of replacement characters.
    const xml =
      '<?xml version="1.0" encoding="windows-1251"?>' +
      '<rss version="2.0"><channel><item><title>Ïðèâåò</title></item></channel></rss>';

    const feed = parseFeed({
      body: Buffer.from(xml, "latin1"),
      feedUrl: FEED_URL,
    });

    expect(feed.items[0]?.title).toBe("Привет");
  });

  it("strips a byte order mark rather than choking on it", () => {
    const xml = `﻿<rss version="2.0"><channel><item><title>Fine</title></item></channel></rss>`;

    expect(parse(xml).items[0]?.title).toBe("Fine");
  });
});
