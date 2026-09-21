/**
 * Who is allowed to do what.
 *
 * Two roles, not a permission editor. A self-hosted instance is one business,
 * usually one to five people, and the honest set of questions is "can this
 * person change what gets watched" and "can this person spend the owner's
 * money on model calls". Anything finer is a settings screen nobody asked for.
 *
 * The table below is the single source of that answer. Checks live here rather
 * than as `if (role === "owner")` scattered through route handlers, because
 * scattered checks are how a new endpoint quietly ships without one.
 *
 * Hiding a button is not authorisation. Every server route calls this.
 *
 * // TODO: security review — authorisation
 */

import { AppError } from "@mifluent/core";

export const MEMBER_ROLES = ["owner", "member"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Named as `<resource>:<action>`. A closed union on purpose: a typo becomes a
 * compile error instead of a permission that silently never matches and
 * therefore always denies — or, worse, a check that was never added.
 */
export type Permission =
  | "profile:read"
  | "profile:write"
  | "digest:read"
  | "member:manage"
  | "instance:manage"
  | "key:manage";

const OWNER_PERMISSIONS: readonly Permission[] = [
  "profile:read",
  "profile:write",
  "digest:read",
  "member:manage",
  "instance:manage",
  "key:manage",
];

/**
 * A member runs the watching and reads the results. What they cannot do is
 * change who else is in the instance, or touch the API keys the owner pays for.
 */
const MEMBER_PERMISSIONS: readonly Permission[] = ["profile:read", "profile:write", "digest:read"];

const PERMISSIONS_BY_ROLE: Readonly<Record<MemberRole, readonly Permission[]>> = {
  owner: OWNER_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
};

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && MEMBER_ROLES.includes(value as MemberRole);
}

export function can(role: MemberRole, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].includes(permission);
}

/**
 * The form used on the server. Throws rather than returning false, so that a
 * caller who forgets to check the return value still fails closed.
 *
 * The message says nothing about which role would have been enough — that is
 * information about the instance's shape, and the person asking is by
 * definition not entitled to it.
 */
export function requirePermission(role: MemberRole, permission: Permission): void {
  if (can(role, permission)) {
    return;
  }

  throw new AppError("forbidden", "You do not have access to that.", { role, permission });
}
