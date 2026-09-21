import { describe, expect, it } from "vitest";
import { AppError, isAppError, toAppError } from "./errors.js";

describe("AppError", () => {
  it("maps each code to an http status", () => {
    expect(new AppError("not_found", "Nope").httpStatus).toBe(404);
    expect(new AppError("rate_limited", "Slow down").httpStatus).toBe(429);
    expect(new AppError("internal_error", "Oops").httpStatus).toBe(500);
  });

  it("keeps details out of the public shape", () => {
    const error = new AppError("source_unreachable", "This source could not be reached.", {
      sourceUrl: "https://internal.example/admin",
      driverMessage: "ECONNREFUSED 10.0.0.5:5432",
    });

    expect(error.toPublic()).toEqual({
      code: "source_unreachable",
      message: "This source could not be reached.",
    });
    expect(JSON.stringify(error.toPublic())).not.toContain("10.0.0.5");
  });

  it("is recognised by the type guard", () => {
    expect(isAppError(new AppError("conflict", "Already exists"))).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
    expect(isAppError("a string")).toBe(false);
  });
});

describe("toAppError", () => {
  it("returns an AppError unchanged", () => {
    const original = new AppError("forbidden", "Not yours");
    expect(toAppError(original)).toBe(original);
  });

  it("hides the message of an unexpected error from the user", () => {
    const converted = toAppError(new Error("connect ECONNREFUSED 127.0.0.1:5432"));

    expect(converted.code).toBe("internal_error");
    expect(converted.message).not.toContain("127.0.0.1");
    expect(converted.details?.["originalMessage"]).toContain("ECONNREFUSED");
  });

  it("handles values that are not errors at all", () => {
    const converted = toAppError("something was thrown");

    expect(converted.code).toBe("internal_error");
    expect(converted.details?.["thrown"]).toBe("something was thrown");
  });
});
