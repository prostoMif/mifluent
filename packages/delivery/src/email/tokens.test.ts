import { describe, expect, it } from "vitest";
import {
  createActionToken,
  createUnsubscribeToken,
  emailLinkSecret,
  parseActionToken,
  parseUnsubscribeToken,
} from "./tokens.js";

const SECRET = "s".repeat(32);
const CARD_ID = "01920000-0000-7000-8000-000000000001";

describe("email link tokens", () => {
  it("reads back what it signed", () => {
    const token = createActionToken(SECRET, CARD_ID, "saved");
    expect(parseActionToken(SECRET, token)).toMatchObject({ cardId: CARD_ID, action: "saved" });
  });

  it("refuses a token whose payload was changed", () => {
    const token = createActionToken(SECRET, CARD_ID, "saved");
    const [, signature] = token.split(".");
    const forged = `${Buffer.from(`${CARD_ID}|not_following_target|9999999999`).toString("base64url")}.${signature}`;
    expect(() => parseActionToken(SECRET, forged)).toThrow();
  });

  it("refuses a token signed with another secret", () => {
    const token = createActionToken("o".repeat(32), CARD_ID, "saved");
    expect(() => parseActionToken(SECRET, token)).toThrow();
  });

  it("does not accept an action token as an unsubscribe token", () => {
    const token = createActionToken(SECRET, CARD_ID, "saved");
    expect(() => parseUnsubscribeToken(SECRET, token)).toThrow();
    expect(parseUnsubscribeToken(SECRET, createUnsubscribeToken(SECRET, CARD_ID)).profileId).toBe(
      CARD_ID,
    );
  });

  it("derives a stable secret from the auth secret when none is set", () => {
    const auth = { BETTER_AUTH_SECRET: "a".repeat(40) };
    expect(emailLinkSecret(auth)).toBe(emailLinkSecret(auth));
    expect(emailLinkSecret(auth)).not.toContain(auth.BETTER_AUTH_SECRET);
    expect(emailLinkSecret({ ...auth, EMAIL_LINK_SECRET: SECRET })).toBe(SECRET);
  });
});
