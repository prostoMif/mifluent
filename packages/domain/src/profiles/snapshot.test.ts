/**
 * Tests for the snapshot module.
 */

import { describe, expect, it } from "vitest";
import {
  areSnapshotsEqual,
  geographyChanged,
  type SelectionSnapshot,
  type SnapshotFacts,
  serialiseSnapshot,
} from "./snapshot.js";
import { readSnapshot } from "./write.js";

const baseSnapshot: SelectionSnapshot = {
  businessDescription: "Test business",
  relevanceThreshold: 0.5,
  topics: [],
  targets: [],
  stopwords: [],
  facts: null,
};

function makeFacts(overrides: Partial<SnapshotFacts> = {}): SnapshotFacts {
  return {
    monetization: "subscription",
    platforms: ["stripe"],
    countries: ["RU", "US"],
    country: "RU",
    extraCountries: ["US"],
    region: "MOW",
    homeCountry: "RU",
    market: "ru",
    customerType: "b2b",
    whatMatters: "pricing changes",
    language: "ru",
    ...overrides,
  };
}

describe("readSnapshot", () => {
  it("migrates old countries array with Russian name to country ISO code", () => {
    const stored = {
      businessDescription: "Test",
      relevanceThreshold: 0.5,
      topics: [],
      targets: [],
      stopwords: [],
      facts: {
        monetization: "subscription",
        platforms: ["stripe"],
        countries: ["Russia", "United States"],
        customerType: "b2b",
        whatMatters: "pricing",
        language: "ru",
      },
    };
    const snapshot = readSnapshot(stored);
    expect(snapshot.facts?.country).toBe("RU");
    expect(snapshot.facts?.countries).toEqual(["Russia", "United States"]);
  });

  it("migrates old countries array with English name to country ISO code", () => {
    const stored = {
      businessDescription: "Test",
      relevanceThreshold: 0.5,
      topics: [],
      targets: [],
      stopwords: [],
      facts: {
        monetization: "subscription",
        platforms: ["stripe"],
        countries: ["Germany", "France"],
        customerType: "b2b",
        whatMatters: "pricing",
        language: "en",
      },
    };
    const snapshot = readSnapshot(stored);
    expect(snapshot.facts?.country).toBe("DE");
  });

  it("does not migrate when country field already exists", () => {
    const stored = {
      businessDescription: "Test",
      relevanceThreshold: 0.5,
      topics: [],
      targets: [],
      stopwords: [],
      facts: {
        monetization: "subscription",
        platforms: ["stripe"],
        countries: ["Russia"],
        country: "US",
        customerType: "b2b",
        whatMatters: "pricing",
        language: "ru",
      },
    };
    const snapshot = readSnapshot(stored);
    expect(snapshot.facts?.country).toBe("US");
  });

  it("returns empty snapshot for invalid data", () => {
    const snapshot = readSnapshot(null);
    expect(snapshot.facts).toBeNull();
  });
});

describe("snapshot", () => {
  describe("serialiseSnapshot", () => {
    it("produces stable output regardless of key order", () => {
      const snap1: SelectionSnapshot = {
        ...baseSnapshot,
        facts: makeFacts(),
      };
      const snap2: SelectionSnapshot = {
        ...baseSnapshot,
        facts: makeFacts(),
      };
      expect(serialiseSnapshot(snap1)).toBe(serialiseSnapshot(snap2));
    });

    it("includes new geography fields", () => {
      const snap: SelectionSnapshot = {
        ...baseSnapshot,
        facts: makeFacts({
          country: "DE",
          extraCountries: ["FR"],
          homeCountry: "DE",
          market: "en",
        }),
      };
      const serialised = serialiseSnapshot(snap);
      const parsed = JSON.parse(serialised);
      expect(parsed.facts.country).toBe("DE");
      expect(parsed.facts.extraCountries).toEqual(["FR"]);
      expect(parsed.facts.homeCountry).toBe("DE");
      expect(parsed.facts.market).toBe("en");
    });
  });

  describe("areSnapshotsEqual", () => {
    it("returns true for identical snapshots", () => {
      const snap1: SelectionSnapshot = { ...baseSnapshot, facts: makeFacts() };
      const snap2: SelectionSnapshot = { ...baseSnapshot, facts: makeFacts() };
      expect(areSnapshotsEqual(snap1, snap2)).toBe(true);
    });

    it("returns false when country changes", () => {
      const snap1: SelectionSnapshot = { ...baseSnapshot, facts: makeFacts({ country: "RU" }) };
      const snap2: SelectionSnapshot = { ...baseSnapshot, facts: makeFacts({ country: "US" }) };
      expect(areSnapshotsEqual(snap1, snap2)).toBe(false);
    });

    it("returns false when extraCountries changes", () => {
      const snap1: SelectionSnapshot = {
        ...baseSnapshot,
        facts: makeFacts({ extraCountries: ["US"] }),
      };
      const snap2: SelectionSnapshot = {
        ...baseSnapshot,
        facts: makeFacts({ extraCountries: ["DE"] }),
      };
      expect(areSnapshotsEqual(snap1, snap2)).toBe(false);
    });

    it("returns false when homeCountry changes", () => {
      const snap1: SelectionSnapshot = { ...baseSnapshot, facts: makeFacts({ homeCountry: "RU" }) };
      const snap2: SelectionSnapshot = { ...baseSnapshot, facts: makeFacts({ homeCountry: "GE" }) };
      expect(areSnapshotsEqual(snap1, snap2)).toBe(false);
    });

    it("returns false when region changes", () => {
      const snap1: SelectionSnapshot = { ...baseSnapshot, facts: makeFacts({ region: "MOW" }) };
      const snap2: SelectionSnapshot = { ...baseSnapshot, facts: makeFacts({ region: "SPE" }) };
      expect(areSnapshotsEqual(snap1, snap2)).toBe(false);
    });

    it("ignores order of extraCountries", () => {
      const snap1: SelectionSnapshot = {
        ...baseSnapshot,
        facts: makeFacts({ extraCountries: ["US", "DE"] }),
      };
      const snap2: SelectionSnapshot = {
        ...baseSnapshot,
        facts: makeFacts({ extraCountries: ["DE", "US"] }),
      };
      expect(areSnapshotsEqual(snap1, snap2)).toBe(true);
    });
  });

  describe("geographyChanged", () => {
    it("returns false when both are null", () => {
      expect(geographyChanged(null, null)).toBe(false);
    });

    it("returns true when one is null", () => {
      expect(geographyChanged(null, makeFacts())).toBe(true);
      expect(geographyChanged(makeFacts(), null)).toBe(true);
    });

    it("returns false when geography is identical", () => {
      const facts = makeFacts();
      expect(geographyChanged(facts, facts)).toBe(false);
    });

    it("returns true when country changes", () => {
      expect(geographyChanged(makeFacts({ country: "RU" }), makeFacts({ country: "US" }))).toBe(
        true,
      );
    });

    it("returns true when homeCountry changes", () => {
      expect(
        geographyChanged(makeFacts({ homeCountry: "RU" }), makeFacts({ homeCountry: "GE" })),
      ).toBe(true);
    });

    it("returns true when extraCountries changes", () => {
      expect(
        geographyChanged(
          makeFacts({ extraCountries: ["US"] }),
          makeFacts({ extraCountries: ["DE"] }),
        ),
      ).toBe(true);
    });

    it("returns true when region changes", () => {
      expect(geographyChanged(makeFacts({ region: "MOW" }), makeFacts({ region: "SPE" }))).toBe(
        true,
      );
    });

    it("uses countries[0] as fallback for country", () => {
      const base = makeFacts();
      const { country: _c, ...prevBase } = base;
      const prev: SnapshotFacts = { ...prevBase, countries: ["RU"] };
      const { country: _c2, ...nextBase } = base;
      const next: SnapshotFacts = { ...nextBase, countries: ["US"] };
      expect(geographyChanged(prev, next)).toBe(true);
    });

    it("uses country as fallback for homeCountry", () => {
      const prev = makeFacts({ country: "RU" });
      const next = makeFacts({ country: "US" });
      expect(geographyChanged(prev, next)).toBe(true);
    });

    it("ignores order of extraCountries", () => {
      const prev = makeFacts({ extraCountries: ["US", "DE"] });
      const next = makeFacts({ extraCountries: ["DE", "US"] });
      expect(geographyChanged(prev, next)).toBe(false);
    });
  });
});
