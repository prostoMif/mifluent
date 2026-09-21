/**
 * The shape of an invitation, without the queries that produce it.
 *
 * Types only, in their own file, so a browser component can name one without
 * importing anything that reaches the database. See `schemas.ts` for why that
 * boundary exists.
 */

import type { MemberRole } from "./roles.js";

export interface Invitation {
  readonly id: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

/** Just the parts that decide whether an invitation still works. */
export interface InvitationState {
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}
