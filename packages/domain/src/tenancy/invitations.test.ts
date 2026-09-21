import { describe, expect, it } from "vitest";
import { hashInvitationToken, INVITATION_LIFETIME_MS, isUsable } from "./invitations.js";

const NOW = new Date("2026-08-19T12:00:00Z");

function invitation(overrides: Partial<Parameters<typeof isUsable>[0]> = {}) {
  return {
    expiresAt: new Date(NOW.getTime() + INVITATION_LIFETIME_MS),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("isUsable", () => {
  it("accepts a fresh invitation", () => {
    expect(isUsable(invitation(), NOW)).toBe(true);
  });

  it("refuses one that has been used", () => {
    // Single use is the whole point: a link forwarded to a second person must
    // not let both of them in.
    expect(isUsable(invitation({ acceptedAt: NOW }), NOW)).toBe(false);
  });

  it("refuses one the owner revoked", () => {
    expect(isUsable(invitation({ revokedAt: NOW }), NOW)).toBe(false);
  });

  it("refuses one that has expired", () => {
    const expired = invitation({ expiresAt: new Date(NOW.getTime() - 1000) });

    expect(isUsable(expired, NOW)).toBe(false);
  });

  it("refuses at the exact moment of expiry rather than a moment after", () => {
    expect(isUsable(invitation({ expiresAt: NOW }), NOW)).toBe(false);
  });

  it("refuses a revoked invitation even if it has not expired", () => {
    const both = invitation({ revokedAt: NOW, expiresAt: new Date(NOW.getTime() + 1000) });

    expect(isUsable(both, NOW)).toBe(false);
  });
});

describe("hashInvitationToken", () => {
  it("produces a hex digest", () => {
    expect(hashInvitationToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same hash for the same token", () => {
    expect(hashInvitationToken("abc")).toBe(hashInvitationToken("abc"));
  });

  it("gives a different hash for a different token", () => {
    expect(hashInvitationToken("abc")).not.toBe(hashInvitationToken("abd"));
  });

  it("never returns the token itself", () => {
    // What is stored must not be reversible into a working link, so that a
    // leaked backup does not hand out accounts.
    expect(hashInvitationToken("some-secret-token")).not.toContain("some-secret-token");
  });
});

describe("INVITATION_LIFETIME_MS", () => {
  it("is a week", () => {
    expect(INVITATION_LIFETIME_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
