import { describe, expect, it } from "vitest";
import { generateBindingCode, hashBindingCode } from "./bind.js";

describe("generateBindingCode", () => {
  it("is eight characters with no look-alike letters or digits", () => {
    const code = generateBindingCode();

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it("does not repeat", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateBindingCode()));

    expect(codes.size).toBe(200);
  });
});

describe("hashBindingCode", () => {
  it("treats a code typed in lower case as the same code", () => {
    expect(hashBindingCode("abcd2345")).toBe(hashBindingCode("ABCD2345"));
  });

  it("never returns the code itself", () => {
    expect(hashBindingCode("ABCD2345")).not.toContain("ABCD2345");
  });
});
