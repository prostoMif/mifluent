import { AppError, isAppError } from "@mifluent/core";
import { describe, expect, it } from "vitest";
import { requireOwnership, withTenant } from "./tenant.js";

const TENANT = "0198f3aa-0000-7000-8000-000000000001";
const OTHER_TENANT = "0198f3aa-0000-7000-8000-000000000002";

describe("requireOwnership", () => {
  it("returns the row when it belongs to the tenant", () => {
    const row = { id: "r1", tenantId: TENANT, name: "Acme" };
    expect(requireOwnership(row, TENANT)).toBe(row);
  });

  it("refuses a row belonging to another tenant", () => {
    const row = { id: "r1", tenantId: OTHER_TENANT, name: "Acme" };
    expect(() => requireOwnership(row, TENANT)).toThrow(AppError);
  });

  it("reports a foreign row as not found, not as forbidden", () => {
    // Saying "forbidden" would confirm the record exists. Same answer for
    // "does not exist" and "not yours" is the whole point.
    const row = { id: "r1", tenantId: OTHER_TENANT };

    try {
      requireOwnership(row, TENANT);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("not_found");
        expect(error.message).not.toContain("tenant");
      }
    }
  });

  it("treats a missing row the same way", () => {
    try {
      requireOwnership(undefined, TENANT);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("not_found");
    }
  });
});

describe("withTenant", () => {
  it("adds the tenant to the values", () => {
    expect(withTenant(TENANT, { name: "Acme" })).toEqual({
      name: "Acme",
      tenantId: TENANT,
    });
  });

  it("rejects a payload carrying a different tenant", () => {
    // This is the write-side half of the bug: a request body smuggling in
    // someone else's tenant id.
    expect(() => withTenant(TENANT, { name: "Acme", tenantId: OTHER_TENANT })).toThrow(AppError);
  });

  it("allows a payload that already carries the correct tenant", () => {
    expect(withTenant(TENANT, { name: "Acme", tenantId: TENANT })).toEqual({
      name: "Acme",
      tenantId: TENANT,
    });
  });

  it("does not let the payload override the tenant it was given", () => {
    const result = withTenant(TENANT, { name: "Acme" });
    expect(result.tenantId).toBe(TENANT);
  });
});
