import { AppError, isAppError } from "@mifluent/core";
import { describe, expect, it } from "vitest";
import { assertRegistrationAllowed } from "./registration-rules.js";

describe("assertRegistrationAllowed", () => {
  it("lets the first person register on an empty instance", () => {
    expect(() =>
      assertRegistrationAllowed({ hasAnyAccount: false, isRegistrationOpen: false }),
    ).not.toThrow();
  });

  it("refuses a second account while registration is closed", () => {
    expect(() =>
      assertRegistrationAllowed({ hasAnyAccount: true, isRegistrationOpen: false }),
    ).toThrow(AppError);
  });

  it("allows a second account once the operator opens registration", () => {
    expect(() =>
      assertRegistrationAllowed({ hasAnyAccount: true, isRegistrationOpen: true }),
    ).not.toThrow();
  });

  it("tells the person what to do instead of just refusing", () => {
    // A bare "forbidden" on a self-hosted instance reads as a bug. The person
    // in front of it needs to know an invitation is the way in.
    try {
      assertRegistrationAllowed({ hasAnyAccount: true, isRegistrationOpen: false });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("forbidden");
      expect(isAppError(error) && error.message).toContain("invitation");
    }
  });
});

describe("assertRegistrationAllowed with an invitation", () => {
  it("lets an invited person in while sign-up is closed", () => {
    // The whole reason invitations exist: one named person, without opening
    // the door to everybody who knows the address.
    expect(() =>
      assertRegistrationAllowed({
        hasAnyAccount: true,
        isRegistrationOpen: false,
        hasValidInvitation: true,
      }),
    ).not.toThrow();
  });

  it("still refuses somebody with no invitation", () => {
    expect(() =>
      assertRegistrationAllowed({
        hasAnyAccount: true,
        isRegistrationOpen: false,
        hasValidInvitation: false,
      }),
    ).toThrow(AppError);
  });
});
