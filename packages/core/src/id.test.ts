import { describe, expect, it } from "vitest";
import { isUuid, uuidv7, uuidv7Timestamp } from "./id.js";

describe("uuidv7", () => {
  it("produces a well-formed uuid", () => {
    expect(isUuid(uuidv7())).toBe(true);
  });

  it("sets version 7 and the rfc variant", () => {
    const id = uuidv7();
    // Version nibble is the first character of the third group.
    expect(id[14]).toBe("7");
    // Variant is the first character of the fourth group: 8, 9, a or b.
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("sorts in creation order as a plain string", () => {
    const ids = Array.from({ length: 500 }, () => uuidv7());
    expect([...ids].sort()).toEqual(ids);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });

  it("carries a readable creation time", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();

    const timestamp = uuidv7Timestamp(id).getTime();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after + 1);
  });
});

describe("isUuid", () => {
  it("rejects things that are not uuids", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("0198f3aa-0000-7000-8000-00000000000")).toBe(false);
    expect(isUuid("0198F3AA-0000-7000-8000-000000000000")).toBe(false);
  });
});
