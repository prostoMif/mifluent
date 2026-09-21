/**
 * Attaching an account to the instance's tenant.
 *
 * One instance holds one tenant. The tenant column is on every table from the
 * first migration so that hosting several businesses later is a configuration
 * problem rather than a rewrite, but nothing here creates a second one: extra
 * people joining a self-hosted instance are joining the same business, not
 * founding their own.
 *
 * So: first account creates the tenant and owns it. Every account after that
 * joins the existing tenant as a member.
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
 * Two people submitting the sign-up form in the same second would both see an
 * empty instance and both become owner. A transaction alone does not prevent
 * it: there is no existing row to lock, and PostgreSQL has nothing to serialise
 * on. An advisory lock is the standard answer — a named lock on a number rather
 * than on a row, released when the transaction ends.
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

/** The tenant this instance belongs to, if it has been claimed. */
async function findInstanceTenantId(db: Queryable): Promise<string | undefined> {
  const [row] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(isNull(schema.tenants.deletedAt))
    .orderBy(asc(schema.tenants.createdAt))
    .limit(1);

  return row?.id;
}

export interface AttachUserOptions {
  readonly db: Database;
  /** Better Auth's identifier for the account that was just created. */
  readonly userId: string;
  /** Used only when this account is the one creating the tenant. */
  readonly tenantName: string;
  /** IANA zone for the new tenant. Storage stays UTC regardless. */
  readonly timezone: string;
  /**
   * The role an invitation asked for, when the account came from one.
   *
   * Only consulted for an account that is not the first: whoever claims an
   * empty instance is its owner regardless of what any invitation says, because
   * at that point there is nobody who could have issued one.
   */
  readonly invitedRole?: MemberRole | undefined;
}

/**
 * Give an account its membership, creating the tenant if this is the first one.
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

    const claimedTenantId = await findInstanceTenantId(transaction);
    const isFirstAccount = claimedTenantId === undefined;

    const tenantId = claimedTenantId ?? (await createTenant(transaction, tenantName, timezone));
    const role: MemberRole = isFirstAccount ? "owner" : (options.invitedRole ?? "member");

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
