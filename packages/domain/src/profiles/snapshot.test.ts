import { describe, expect, it } from "vitest";
import { areSnapshotsEqual, type SelectionSnapshot } from "./snapshot.js";

function snapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    businessDescription: "A shop selling ceramics online",
    relevanceThreshold: 0.5,
    topics: [{ label: "pricing", description: null }],
    targets: [{ kind: "platform", name: "Stripe", aliases: [] }],
    stopwords: ["hiring"],
    facts: {
      monetization: "subscription",
      platforms: ["Stripe"],
      countries: ["US"],
      customerType: "b2c",
      whatMatters: "Payment processing reliability",
      language: "en",
    },
    ...overrides,
  };
}

describe("areSnapshotsEqual", () => {
  it("treats two identical snapshots as equal", () => {
    expect(areSnapshotsEqual(snapshot(), snapshot())).toBe(true);
  });

  it("ignores the order topics came back in", () => {
    // Row order is whatever the database felt like. Treating it as a change
    // would mint a new profile version on every save.
    const first = snapshot({
      topics: [
        { label: "pricing", description: null },
        { label: "shipping", description: null },
      ],
    });
    const second = snapshot({
      topics: [
        { label: "shipping", description: null },
        { label: "pricing", description: null },
      ],
    });

    expect(areSnapshotsEqual(first, second)).toBe(true);
  });

  it("ignores the order of a target's aliases", () => {
    const first = snapshot({
      targets: [{ kind: "competitor", name: "Acme", aliases: ["a", "b"] }],
    });
    const second = snapshot({
      targets: [{ kind: "competitor", name: "Acme", aliases: ["b", "a"] }],
    });

    expect(areSnapshotsEqual(first, second)).toBe(true);
  });

  it("notices a new topic", () => {
    const changed = snapshot({
      topics: [
        { label: "pricing", description: null },
        { label: "shipping", description: null },
      ],
    });

    expect(areSnapshotsEqual(snapshot(), changed)).toBe(false);
  });

  it("notices a changed threshold", () => {
    expect(areSnapshotsEqual(snapshot(), snapshot({ relevanceThreshold: 0.7 }))).toBe(false);
  });

  it("notices a rewritten business description", () => {
    expect(areSnapshotsEqual(snapshot(), snapshot({ businessDescription: "Something else" }))).toBe(
      false,
    );
  });

  it("treats a missing description and an empty one as the same", () => {
    // They mean the same thing to the collector, and a form that submits "" for
    // a field the database holds as NULL is the normal case, not an edge one.
    const withNull = snapshot({ businessDescription: null });
    const withEmpty = snapshot({ businessDescription: "" });

    expect(areSnapshotsEqual(withNull, withEmpty)).toBe(true);
  });

  it("notices a removed stopword", () => {
    expect(areSnapshotsEqual(snapshot(), snapshot({ stopwords: [] }))).toBe(false);
  });

  it("distinguishes two targets that differ only by kind", () => {
    // The same name watched as a competitor and as a platform is matched
    // differently, so this is a real change.
    const asPlatform = snapshot({ targets: [{ kind: "platform", name: "Acme", aliases: [] }] });
    const asCompetitor = snapshot({ targets: [{ kind: "competitor", name: "Acme", aliases: [] }] });

    expect(areSnapshotsEqual(asPlatform, asCompetitor)).toBe(false);
  });

  it("notices changed facts", () => {
    expect(
      areSnapshotsEqual(
        snapshot(),
        snapshot({ facts: { ...snapshot().facts, monetization: "free" } }),
      ),
    ).toBe(false);
  });

  it("ignores order of platforms and countries in facts", () => {
    const first = snapshot({
      facts: {
        ...snapshot().facts,
        platforms: ["Stripe", "Vercel"],
        countries: ["US", "EU"],
      },
    });
    const second = snapshot({
      facts: {
        ...snapshot().facts,
        platforms: ["Vercel", "Stripe"],
        countries: ["EU", "US"],
      },
    });
    expect(areSnapshotsEqual(first, second)).toBe(true);
  });
});
