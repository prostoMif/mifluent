/**
 * Who is making this request, and what they are allowed to do.
 *
 * Every server route and every page that shows tenant data starts here. The
 * point of funnelling it through one file is that `tenantId` and `role` arrive
 * together, from the database, on every request — never from a request body,
 * never from a cookie the caller could edit, and never assumed because the
 * previous line already looked something up.
 *
 * // TODO: security review — authentication, authorisation
 */

import { AppError, getConfig } from "@mifluent/core";
import {
  attachUserToInstance,
  findMembershipByUserId,
  type MemberRole,
  type Permission,
  requirePermission,
} from "@mifluent/domain";
import { headers } from "next/headers";
import { getAuth } from "./auth";
import { getDatabase } from "./db";
import { logger } from "./logger";

export interface SessionContext {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly tenantId: string;
  readonly role: MemberRole;
}

/**
 * The signed-in caller, or nothing.
 *
 * Returns `undefined` rather than throwing so that a page can render a signed-
 * out view. Anything that touches data uses `requireSession` below.
 */
export async function getSessionContext(): Promise<SessionContext | undefined> {
  const session = await getAuth().api.getSession({ headers: await headers() });

  if (session === null) {
    return undefined;
  }

  const { user } = session;
  const membership = await resolveMembership(user.id, user.name);

  if (membership === undefined) {
    return undefined;
  }

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    tenantId: membership.tenantId,
    role: membership.role,
  };
}

/** The caller, or a refusal. Use in every route handler and server action. */
export async function requireSession(): Promise<SessionContext> {
  const context = await getSessionContext();

  if (context === undefined) {
    throw new AppError("unauthorized", "Sign in to continue.");
  }

  return context;
}

/**
 * The caller, refused unless their role carries the permission.
 *
 * This is the call that belongs at the top of a handler. `requireSession`
 * alone answers "is anyone there", which is the half of the question that
 * lets a member perform an owner's action.
 */
export async function requireSessionWith(permission: Permission): Promise<SessionContext> {
  const context = await requireSession();
  requirePermission(context.role, permission);
  return context;
}

/**
 * Find the membership, and repair it if it is missing.
 *
 * An account without a membership should be impossible — one is created in the
 * sign-up hook. If it happens anyway, the person is signed in and staring at an
 * application that shows them nothing, with no way to fix it themselves.
 * Rebuilding it is idempotent and cheap. The warning is there so that the
 * underlying bug still gets noticed.
 */
async function resolveMembership(
  userId: string,
  userName: string,
): Promise<{ tenantId: string; role: MemberRole } | undefined> {
  const database = getDatabase();
  const existing = await findMembershipByUserId(database, userId);

  if (existing !== undefined) {
    return existing;
  }

  logger.warn("tenancy.membership_missing", { userId });

  const repaired = await attachUserToInstance({
    db: database,
    userId,
    tenantName: userName,
    timezone: getConfig().DEFAULT_TIMEZONE,
  });

  return repaired;
}
