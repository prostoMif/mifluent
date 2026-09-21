import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isAppError } from "./errors.js";
import { parseOrThrow } from "./validation.js";

const schema = z.object({
  name: z.string().min(1, "Enter a name."),
  count: z.number().int(),
});

describe("parseOrThrow", () => {
  it("returns the parsed value when it is valid", () => {
    expect(parseOrThrow(schema, { name: "Acme", count: 2 })).toEqual({ name: "Acme", count: 2 });
  });

  it("reports a bad payload as the caller's mistake, not ours", () => {
    // The distinction matters: 500 puts this in somebody's incident channel,
    // 400 puts it in front of the person who mistyped.
    try {
      parseOrThrow(schema, { name: "", count: 2 });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("validation_failed");
      expect(isAppError(error) && error.httpStatus).toBe(400);
    }
  });

  it("names the field that was wrong", () => {
    try {
      parseOrThrow(schema, { name: "", count: 2 });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && error.message).toContain("name");
    }
  });

  it("keeps the full issue list for the log", () => {
    try {
      parseOrThrow(schema, {});
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && Array.isArray(error.details?.["issues"])).toBe(true);
    }
  });

  it("handles a payload that is not an object at all", () => {
    expect(() => parseOrThrow(schema, "nonsense")).toThrow();
  });
});
