/**
 * Finding a customer by what the owner knows about them — an email, a
 * Telegram id, part of the business name — for payments taken by hand.
 *
 * Owner-only: it reads across tenants, so it is called from the owner's
 * command line, never from a route.
 */

import { isUuid } from "@mifluent/core";
import { type Queryable, schema } from "@mifluent/db";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";

export interface CustomerRow {
  readonly tenantId: string;
  readonly name: string;
  readonly plan: string;
  readonly email: string;
  readonly telegramUserId: string | null;
  readonly createdAt: Date;
}

/** The newest sign-ups, or those matching `search`; owners of each tenant only. */
export async function findCustomers(
  db: Queryable,
  search: string | undefined,
  limit = 20,
): Promise<CustomerRow[]> {
  const term = search?.trim();
  const matches =
    term === undefined || term === ""
      ? undefined
      : or(
          eq(schema.user.email, term.toLowerCase()),
          eq(schema.user.telegramUserId, term),
          isUuid(term) ? eq(schema.tenants.id, term) : undefined,
          ilike(schema.tenants.name, `%${term.replace(/[%_\\]/g, "\\$&")}%`),
        );

  return db
    .select({
      tenantId: schema.tenants.id,
      name: schema.tenants.name,
      plan: schema.tenants.plan,
      email: schema.user.email,
      telegramUserId: schema.user.telegramUserId,
      createdAt: schema.tenants.createdAt,
    })
    .from(schema.tenants)
    .innerJoin(schema.memberships, eq(schema.memberships.tenantId, schema.tenants.id))
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(
      and(
        isNull(schema.tenants.deletedAt),
        isNull(schema.memberships.deletedAt),
        eq(schema.memberships.role, "owner"),
        matches,
      ),
    )
    .orderBy(desc(schema.tenants.createdAt))
    .limit(limit);
}
