import { describe, expect, it } from "vitest";
import type { ProfileVector } from "../profile.js";
import { cosineCutoff, findStopword, scoreItem } from "./score.js";

const competitor: ProfileVector = { refKind: "target", refId: "t-1", vector: [1, 0, 0] };
const topic: ProfileVector = { refKind: "topic", refId: null, vector: [0, 1, 0] };

describe("scoreItem", () => {
  it("scores an item by its best chunk, not its average", () => {
    const chunks = [
      [0, 0, 1],
      [0.9, 0.1, 0],
    ];

    const result = scoreItem(chunks, [competitor, topic]);

    expect(result.score).toBeGreaterThan(0.99);
  });

  it("names the target the best match points at", () => {
    const result = scoreItem([[1, 0.1, 0]], [competitor, topic]);

    expect(result.nearestTargetId).toBe("t-1");
  });

  it("names no target when the best match is a topic", () => {
    const result = scoreItem([[0.1, 1, 0]], [competitor, topic]);

    expect(result.nearestTargetId).toBeNull();
  });

  it("gives an item with no chunks the lowest score", () => {
    const result = scoreItem([], [competitor]);

    expect(result.score).toBe(-1);
  });
});

describe("cosineCutoff", () => {
  it("cuts near 0.80 at the default strictness, inside e5's band", () => {
    const cutoff = cosineCutoff(0.5);

    expect(cutoff).toBeCloseTo(0.8025);
  });

  it("keeps everything at the loosest setting", () => {
    const cutoff = cosineCutoff(0);

    expect(cutoff).toBe(0.75);
  });
});

describe("findStopword", () => {
  it("matches a whole word in any case", () => {
    const found = findStopword("Join our WEBINAR on pricing", ["webinar"]);

    expect(found).toBe("webinar");
  });

  it("does not match inside another word", () => {
    const found = findStopword("Webinars are back", ["webinar"]);

    expect(found).toBeNull();
  });

  it("matches a Russian stopword", () => {
    const found = findStopword("Вебинар о ценах", ["вебинар"]);

    expect(found).toBe("вебинар");
  });
});
