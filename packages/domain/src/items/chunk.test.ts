import { describe, expect, it } from "vitest";
import { chunkRawItem, chunkText } from "./chunk.js";

function paragraphs(count: number, length: number): string {
  return Array.from({ length: count }, (_, index) =>
    `Paragraph ${index} ${"word ".repeat(length / 5)}`.trim(),
  ).join("\n\n");
}

describe("chunkText", () => {
  it("returns nothing for blank text", () => {
    const chunks = chunkText("  \n\n  ");

    expect(chunks).toEqual([]);
  });

  it("keeps a short item as one chunk instead of dropping it", () => {
    const text = "Pro plan now $49.";

    const chunks = chunkText(text);

    expect(chunks).toEqual([{ content: text, startOffset: 0, endOffset: text.length }]);
  });

  it("packs several short paragraphs into one chunk", () => {
    const text = paragraphs(5, 100);

    const chunks = chunkText(text);

    expect(chunks).toHaveLength(1);
  });

  it("gives offsets that slice back to exactly the chunk", () => {
    const text = `  Lead.\n\n${paragraphs(30, 300)}\n\n\n  Tail paragraph.  `;

    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
    }
  });

  it("overlaps consecutive chunks", () => {
    const text = paragraphs(30, 300);

    const [first, second] = chunkText(text);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second?.startOffset ?? 0).toBeLessThan(first?.endOffset ?? 0);
  });

  it("cuts one very long paragraph into windows that cover it", () => {
    const text = "word ".repeat(2_000).trim();

    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startOffset).toBe(0);
    expect(chunks.at(-1)?.endOffset).toBe(text.length);
    for (const chunk of chunks) {
      expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
    }
  });
});

describe("chunkRawItem", () => {
  it("embeds only the added text of a diff, with offsets into the full content", () => {
    const added = "Business plan: $99 per month";
    const content = `ADDED:\n${added}\n\nREMOVED:\nBusiness plan: $79 per month`;

    const chunks = chunkRawItem({ content, kind: "diff", addedText: added });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(added);
    expect(content.slice(chunks[0]?.startOffset, chunks[0]?.endOffset)).toBe(added);
  });

  it("returns nothing for a diff that only removed text", () => {
    const chunks = chunkRawItem({
      content: "ADDED:\n\n\nREMOVED:\nold",
      kind: "diff",
      addedText: "",
    });

    expect(chunks).toEqual([]);
  });
});
