import { describe, expect, it } from "vitest";
import { findDirective } from "./directives.js";

describe("findDirective", () => {
  it("catches an English imperative", () => {
    const found = findDirective("Raise your prices before they do.");

    expect(found).toBe("raise");
  });

  it("catches a Russian imperative", () => {
    const found = findDirective("Свяжитесь с поддержкой Stripe.");

    expect(found).toBe("свяжитесь");
  });

  it("catches advice phrased as a recommendation", () => {
    const found = findDirective("You should review your plan limits.");

    expect(found).toBe("you should");
  });

  it("lets a consequence through", () => {
    const found = findDirective("Your cheapest plan is now $10 below theirs.");

    expect(found).toBeNull();
  });

  it("does not match a longer word that starts like a verb", () => {
    const found = findDirective("Actually, their churn fell.");

    expect(found).toBeNull();
  });
});
