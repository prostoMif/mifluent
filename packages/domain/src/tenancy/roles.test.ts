import { AppError } from "@mifluent/core";
import { describe, expect, it } from "vitest";
import { can, isMemberRole, MEMBER_ROLES, type Permission, requirePermission } from "./roles.js";

describe("can", () => {
  it("lets an owner manage members", () => {
    expect(can("owner", "member:manage")).toBe(true);
  });

  it("does not let a member manage members", () => {
    expect(can("member", "member:manage")).toBe(false);
  });

  it("does not let a member touch the instance's API keys", () => {
    expect(can("member", "key:manage")).toBe(false);
  });

  it("lets a member edit what is being watched", () => {
    expect(can("member", "profile:write")).toBe(true);
  });

  it("grants an owner everything a member has", () => {
    const memberPermissions: Permission[] = ["profile:read", "profile:write", "digest:read"];

    const missing = memberPermissions.filter((permission) => !can("owner", permission));

    expect(missing).toEqual([]);
  });
});

describe("requirePermission", () => {
  it("returns quietly when the role is allowed", () => {
    expect(() => requirePermission("owner", "instance:manage")).not.toThrow();
  });

  it("throws when the role is not allowed", () => {
    expect(() => requirePermission("member", "instance:manage")).toThrow(AppError);
  });

  it("does not reveal which role would have been enough", () => {
    // The message reaches the user. Saying "owners only" describes the shape of
    // the instance to somebody who is not entitled to know it.
    try {
      requirePermission("member", "instance:manage");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).not.toContain("owner");
    }
  });
});

describe("isMemberRole", () => {
  it("accepts every role in the list", () => {
    expect(MEMBER_ROLES.every(isMemberRole)).toBe(true);
  });

  it("rejects a role invented elsewhere", () => {
    expect(isMemberRole("admin")).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(isMemberRole(1)).toBe(false);
  });
});
