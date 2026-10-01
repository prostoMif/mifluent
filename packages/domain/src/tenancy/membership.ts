/**
 * Attaching an account to a tenant.
 *
 * An account that arrives with an invitation joins the tenant that invited
 * it, in the role the invitation names. Every other account founds its own
 * tenant and owns it. On the hosted service that is every new customer; on a
 * self-hosted instance with sign-up closed it is only the first account,
 * because nobody else can get past the sign-up gate without an invitation.
 *
 * An earlier version joined every uninvited account to the oldest tenant —
 * one business per instance. With sign-up open that put each new customer
 * inside the first customer's business, data and all.
 *
 * // TODO: security review — authorisation
 */

import { AppError, uuidv7 } from "@mifluent/core";
import { type Database, type Queryable, schema } from "@mifluent/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { MemberRole } from "./roles.js";

export interface Membership {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: MemberRole;
}

/**
 * Guards the read-then-create below.
 *
 * The sign-up hook and a page load's membership repair can run for the same
 * account in the same second; both would find no membership and each found a
 * tenant. A transaction alone does not prevent it: there is no existing row to
 * lock. An advisory lock is the standard answer — a named lock on a number
 * rather than on a row, released when the transaction ends.
 *
 * The number itself is arbitrary and only has to be unique within this
 * database. It is the ASCII of "mifl".
 */
const INSTANCE_CLAIM_LOCK_KEY = 1_835_363_692;

export async function findMembershipByUserId(
  db: Queryable,
  userId: string,
): Promise<Membership | undefined> {
  const [row] = await db
    .select({
      tenantId: schema.memberships.tenantId,
      userId: schema.memberships.userId,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), isNull(schema.memberships.deletedAt)))
    // Oldest first. A person who somehow ends up with two memberships keeps the
    // one they had, rather than having their role change on a later login.
    .orderBy(asc(schema.memberships.createdAt))
    .limit(1);

  return row;
}

export interface AttachUserOptions {
  readonly db: Database;
  /** Better Auth's identifier for the account that was just created. */
  readonly userId: string;
  /** Used only when this account founds its own tenant. */
  readonly tenantName: string;
  /** IANA zone for the new tenant. Storage stays UTC regardless. */
  readonly timezone: string;
  /** The invitation this account signed up with, if any: its tenant and role. */
  readonly invitation?: { readonly tenantId: string; readonly role: MemberRole } | undefined;
}

/**
 * Give an account its membership: the inviting tenant, or a new one it owns.
 *
 * Idempotent. It runs from a Better Auth hook during sign-up, and is called
 * again if a session ever turns up without a membership — an account that
 * exists but cannot see anything is a worse failure than doing this twice.
 */
export async function attachUserToInstance(options: AttachUserOptions): Promise<Membership> {
  const { db, userId, tenantName, timezone } = options;

  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(${INSTANCE_CLAIM_LOCK_KEY}::bigint)`,
    );

    const existing = await findMembershipByUserId(transaction, userId);
    if (existing !== undefined) {
      return existing;
    }

    const invitation = options.invitation;
    const tenantId =
      invitation?.tenantId ?? (await createTenant(transaction, tenantName, timezone));
    const role: MemberRole = invitation?.role ?? "owner";

    await transaction.insert(schema.memberships).values({
      id: uuidv7(),
      tenantId,
      userId,
      role,
    });

    return { tenantId, userId, role };
  });
}

async function createTenant(db: Queryable, name: string, timezone: string): Promise<string> {
  const tenantId = uuidv7();

  await db.insert(schema.tenants).values({
    id: tenantId,
    name: name.trim() === "" ? "My business" : name.trim(),
    timezone,
  });

  return tenantId;
}

/**
 * The membership a request runs under, or a refusal.
 *
 * Separated from `findMembershipByUserId` so that the "signed in but not a
 * member of anything" case has exactly one place to be handled, and that place
 * fails closed.
 */
export function requireMembership(membership: Membership | undefined, userId: string): Membership {
  if (membership === undefined) {
    throw new AppError("forbidden", "This account is not part of this instance.", { userId });
  }

  return membership;
}
