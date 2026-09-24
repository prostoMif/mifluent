import { describe, expect, it } from "vitest";
import { centroid, cosineSimilarity, getEmbeddingProvider, splitRows } from "./index.js";

describe("splitRows", () => {
  it("splits a flat tensor into one vector per row", () => {
    const rows = splitRows([1, 2, 3, 4, 5, 6], [2, 3], 3);

    expect(rows.map((row) => Array.from(row))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("refuses a tensor of the wrong width", () => {
    const split = (): unknown => splitRows([1, 2, 3, 4], [2, 2], 3);

    expect(split).toThrow(/expected \[n, 3\]/);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for the same direction", () => {
    const similarity = cosineSimilarity([1, 2, 3], [2, 4, 6]);

    expect(similarity).toBeCloseTo(1);
  });

  it("is 0 for orthogonal vectors", () => {
    const similarity = cosineSimilarity([1, 0], [0, 1]);

    expect(similarity).toBe(0);
  });
});

describe("centroid", () => {
  it("returns a unit vector between its inputs", () => {
    const middle = centroid([
      [1, 0],
      [0, 1],
    ]);

    expect(Array.from(middle)[0]).toBeCloseTo(Math.SQRT1_2);
    expect(Array.from(middle)[1]).toBeCloseTo(Math.SQRT1_2);
  });
});

/*
 * Loads the real model (~120 MB, downloaded once). Off by default so the unit
 * suite stays offline; run with RUN_MODEL_TESTS=1.
 */
describe.runIf(process.env["RUN_MODEL_TESTS"] === "1")("local model", () => {
  it("places a Russian and an English sentence about prices closer than an unrelated one", async () => {
    const provider = getEmbeddingProvider();

    const [price, cena, weather] = await provider.embedPassage([
      "The Pro plan now costs $49 per month.",
      "Тариф Про теперь стоит 49 долларов в месяц.",
      "It will rain in Lisbon tomorrow.",
    ]);

    expect(price?.length).toBe(384);
    expect(cosineSimilarity(price ?? [], cena ?? [])).toBeGreaterThan(
      cosineSimilarity(price ?? [], weather ?? []),
    );
  }, 120_000);
});
