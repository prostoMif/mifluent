/**
 * Erasing a business and everyone who belonged only to it — the "delete my
 * data" the privacy policy promises.
 *
 * Owner-only: it is run from the owner's command line on a person's request,
 * never from a route. Every table that carries `tenant_id` references the
 * tenant with ON DELETE CASCADE, so removing the tenant row removes profiles,
 * sources, material, digests, decisions, payments and logs with it. A user
 * who was a member of no other business is removed too; their sessions and
 * credentials cascade from the user row.
 *
 * Receipts are not lost by this: for a самозанятый they live in «Мой налог»,
 * which is the record the tax service relies on.
 */

import { type Queryable, schema } from "@mifluent/db";
import { and, eq, inArray, ne } from "drizzle-orm";

export interface ErasedTenant {
  readonly tenantId: string;
  readonly usersErased: number;
}

export async function eraseTenant(db: Queryable, tenantId: string): Promise<ErasedTenant> {
  return db.transaction(async (transaction) => {
    const members = await transaction
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(eq(schema.memberships.tenantId, tenantId));
    const memberIds = members.map((member) => member.userId);

    const elsewhere =
      memberIds.length === 0
        ? []
        : await transaction
            .select({ userId: schema.memberships.userId })
            .from(schema.memberships)
            .where(
              and(
                inArray(schema.memberships.userId, memberIds),
                ne(schema.memberships.tenantId, tenantId),
              ),
            );
    const keep = new Set(elsewhere.map((row) => row.userId));
    const onlyHere = memberIds.filter((id) => !keep.has(id));

    await transaction.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    if (onlyHere.length > 0) {
      await transaction.delete(schema.user).where(inArray(schema.user.id, onlyHere));
    }
    return { tenantId, usersErased: onlyHere.length };
  });
}
