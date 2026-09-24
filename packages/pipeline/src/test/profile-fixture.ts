import type { ProfileContext } from "../profile.js";

/** A profile for tests. Every field can be overridden. */
export function makeProfile(overrides: Partial<ProfileContext> = {}): ProfileContext {
  return {
    tenantId: "00000000-0000-7000-8000-000000000001",
    profileId: "00000000-0000-7000-8000-000000000002",
    versionId: "00000000-0000-7000-8000-000000000003",
    name: "Analytics SaaS",
    businessDescription: "Privacy-friendly web analytics for small sites.",
    relevanceThreshold: 0.5,
    facts: { customerType: "b2b", platforms: ["Stripe"], language: "en" },
    language: "en",
    targets: [
      {
        id: "00000000-0000-7000-8000-00000000000a",
        kind: "competitor",
        name: "Fathom",
        reason: "Sells the same product to the same people.",
        aliases: [],
      },
      {
        id: "00000000-0000-7000-8000-00000000000b",
        kind: "platform",
        name: "Stripe",
        reason: "Takes every payment.",
        aliases: ["Stripe Billing"],
      },
    ],
    topics: [{ label: "GDPR", description: "Rules on consent and tracking" }],
    stopwords: ["webinar"],
    ...overrides,
  };
}
