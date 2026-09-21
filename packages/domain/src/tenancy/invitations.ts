/**
 * Letting somebody else into an instance whose sign-up is closed.
 *
 * The alternative this replaces is the `REGISTRATION_OPEN` setting, which is a
 * blunt instrument: to admit one person it opens the door to everybody who
 * knows the address, for as long as it is switched on. An invitation admits one
 * named person once.
 *
 * Two shapes exist in the wild and both are defensible.
 *
 * Immich — the closest comparable product, self-hosted and usually without a
 * mail server — has no invitations at all: the owner creates the account and
 * hands over a password the new person changes on first sign-in. Simpler, and
 * it needs no tokens. The cost is that the owner knows somebody else's password
 * for a while, which is a thing worth not knowing.
 *
 * So this takes the other shape: the owner produces a link, sends it by
 * whatever channel they already use, and the person who opens it chooses their
 * own password. No mail server is needed for that, which matters because most
 * instances will not have one.
 *
 * The link is a bearer token — anybody holding it can use it — so it is
 * single-use, expires, and is stored only as a hash. A leaked database backup
 * must not contain working invitations.
 *
 * // TODO: security review — authentication, authorisation
 */

import { createHash, randomBytes } from "node:crypto";
import { AppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Invitation, InvitationState } from "./invitation-types.js";
import type { MemberRole } from "./roles.js";

/**
 * Seven days, which is what GitHub uses for the same thing. Long enough to
 * survive a holiday, short enough that a link forgotten in a chat history stops
 * working before anybody finds it.
 */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 32 bytes of randomness. The token is the only thing standing between a
 * stranger and an account on this instance, so it has to be unguessable rather
 * than merely long.
 */
const TOKEN_BYTES = 32;

export interface CreatedInvitation {
  readonly invitation: Invitation;
  /**
   * The part that goes in the link.
   *
   * Returned exactly once, from the call that created it, and never stored in
   * readable form. If the owner loses it they issue a new invitation — which is
   * the same answer every system that handles this correctly gives.
   */
  readonly token: string;
}

/** Only ever the hash is written down. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateInvitationOptions {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly invitedByUserId: string;
  readonly now?: Date | undefined;
}

export async function createInvitation(
  options: CreateInvitationOptions,
): Promise<CreatedInvitation> {
  const now = options.now ?? new Date();
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  const [row] = await options.db
    .insert(schema.invitations)
    .values({
      id: uuidv7(),
      tenantId: options.tenantId,
      email: options.email,
      role: options.role,
      tokenHash: hashInvitationToken(token),
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
      invitedByUserId: options.invitedByUserId,
    })
    .returning();

  if (row === undefined) {
    throw new AppError("internal_error", "Something went wrong on our side.", {
      reason: "invitation was not written",
    });
  }

  return { invitation: toInvitation(row), token };
}

export async function listInvitations(db: Queryable, tenantId: string): Promise<Invitation[]> {
  const rows = await db
    .select()
    .from(schema.invitations)
    .where(scoped(schema.invitations, tenantId))
    .orderBy(desc(schema.invitations.createdAt));

  return rows.map(toInvitation);
}

export async function revokeInvitation(
  db: Queryable,
  tenantId: string,
  invitationId: string,
  now: Date = new Date(),
): Promise<void> {
  const revoked = await db
    .update(schema.invitations)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        scoped(schema.invitations, tenantId, eq(schema.invitations.id, invitationId)),
        // Revoking one that was already used would rewrite history for no gain.
        isNull(schema.invitations.acceptedAt),
      ),
    )
    .returning({ id: schema.invitations.id });

  if (revoked.length === 0) {
    throw new AppError("not_found", "Not found.");
  }
}

export interface UsableInvitation extends Invitation {
  readonly tenantId: string;
}

/**
 * The invitation behind a token, if it can still be used.
 *
 * Deliberately not scoped to a tenant: whoever is holding the link is not
 * signed in and belongs to nothing yet, so the token itself is the only thing
 * that can say which instance they were invited to.
 */
export async function findUsableInvitation(
  db: Queryable,
  token: string,
  now: Date = new Date(),
): Promise<UsableInvitation | undefined> {
  const [row] = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.tokenHash, hashInvitationToken(token)))
    .limit(1);

  if (row === undefined || !isUsable(row, now)) {
    return undefined;
  }

  return { ...toInvitation(row), tenantId: row.tenantId };
}

/**
 * Pure, so the three ways an invitation stops working can be tested without a
 * database — and so that adding a fourth means changing one function.
 */
export function isUsable(invitation: InvitationState, now: Date): boolean {
  if (invitation.revokedAt !== null) {
    return false;
  }

  if (invitation.acceptedAt !== null) {
    return false;
  }

  return invitation.expiresAt.getTime() > now.getTime();
}

/**
 * Mark an invitation used.
 *
 * Conditional on it still being unused, so two people opening the same link at
 * the same moment cannot both get in: the second update matches nothing.
 */
export async function markInvitationAccepted(
  db: Queryable,
  invitationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const accepted = await db
    .update(schema.invitations)
    .set({ acceptedAt: now, updatedAt: now })
    .where(and(eq(schema.invitations.id, invitationId), isNull(schema.invitations.acceptedAt)))
    .returning({ id: schema.invitations.id });

  return accepted.length > 0;
}

interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
