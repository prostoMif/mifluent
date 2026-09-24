import { describe, expect, it } from "vitest";
import { toSafeLink } from "./url.js";

describe("toSafeLink", () => {
  it("keeps an ordinary https link", () => {
    const link = "https://example.com/pricing?plan=pro";

    const result = toSafeLink(link);

    expect(result).toBe(link);
  });

  it("drops a javascript link", () => {
    const result = toSafeLink("javascript:alert(1)");

    expect(result).toBeNull();
  });

  it("drops a link with credentials in front of the host", () => {
    const result = toSafeLink("https://bank.example@evil.example/login");

    expect(result).toBeNull();
  });

  it("drops a host without a dot", () => {
    const result = toSafeLink("http://localhost/admin");

    expect(result).toBeNull();
  });

  it("removes an existing fragment so a text fragment can be appended", () => {
    const result = toSafeLink("https://example.com/post#comments");

    expect(result).toBe("https://example.com/post");
  });
});
