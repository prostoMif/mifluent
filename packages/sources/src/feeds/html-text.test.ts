import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-text.js";

describe("htmlToText", () => {
  it("removes tags and keeps the words", () => {
    expect(htmlToText("<p>We <strong>raised</strong> prices.</p>")).toBe("We raised prices.");
  });

  it("keeps paragraphs apart", () => {
    // The next stage splits this into chunks to embed. Run everything together
    // and the chunks stop lining up with what the author meant by a paragraph.
    expect(htmlToText("<p>First.</p><p>Second.</p>")).toBe("First.\n\nSecond.");
  });

  it("turns a line break tag into a line break", () => {
    expect(htmlToText("One<br>Two")).toBe("One\nTwo");
  });

  it("keeps list items on separate lines", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("One\n\nTwo");
  });

  it("throws away the body of a script, not only its tags", () => {
    // Stripping tags alone would leave the code itself behind as "text", and
    // somebody's summary would read as a page of JavaScript.
    const html = "<p>Before</p><script>var evil = 1; alert('x');</script><p>After</p>";

    const text = htmlToText(html);

    expect(text).not.toContain("alert");
    expect(text).not.toContain("var evil");
    expect(text).toContain("Before");
    expect(text).toContain("After");
  });

  it("throws away the body of a style block", () => {
    expect(htmlToText("<style>body { color: red }</style><p>Text</p>")).toBe("Text");
  });

  it("removes comments", () => {
    expect(htmlToText("<p>A<!-- hidden note -->B</p>")).toBe("A B");
  });

  it("decodes the references XML defines", () => {
    expect(htmlToText("<p>Tom &amp; Jerry</p>")).toBe("Tom & Jerry");
  });

  it("decodes the HTML references feeds actually use", () => {
    expect(htmlToText("<p>one&nbsp;two &mdash; three&hellip;</p>")).toBe("one two — three…");
  });

  it("leaves an entity it does not know rather than guessing", () => {
    expect(htmlToText("<p>&fnof;</p>")).toBe("&fnof;");
  });

  it("collapses the indentation markup is full of", () => {
    const html = "<div>\n    <p>   Spread   out   </p>\n</div>";

    expect(htmlToText(html)).toBe("Spread out");
  });

  it("returns an empty string for nothing at all", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText("")).toBe("");
    expect(htmlToText("   ")).toBe("");
  });

  it("leaves plain text alone", () => {
    expect(htmlToText("Just a sentence.")).toBe("Just a sentence.");
  });

  it("does not choke on unclosed tags", () => {
    // Feeds contain broken markup constantly, and a summary is not worth
    // failing a whole poll over.
    expect(htmlToText("<p>Open and never closed")).toBe("Open and never closed");
  });
});
