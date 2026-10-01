/**
 * Where customers came from, and how many of them pay: one row per channel
 * and code. This is how a post or a partner is judged — sign-ups alone say
 * little; paying customers say whether it paid off.
 */

import { type Queryable, schema } from "@mifluent/db";
import { and, isNull, ne, sql } from "drizzle-orm";
import { PACKS_TENANT_ID } from "../packs/tenant.js";

export interface AcquisitionRow {
  readonly via: string;
  readonly code: string | null;
  readonly tenants: number;
  readonly paying: number;
}

export async function acquisitionSummary(db: Queryable): Promise<AcquisitionRow[]> {
  const paid = sql`exists (select 1 from ${schema.paymentOrders} where ${schema.paymentOrders.tenantId} = ${schema.tenants.id} and ${schema.paymentOrders.status} = 'paid' and ${schema.paymentOrders.provider} = 'prodamus')`;
  return db
    .select({
      via: schema.tenants.acquiredVia,
      code: schema.tenants.acquiredCode,
      tenants: sql<number>`count(*)`.mapWith(Number),
      paying: sql<number>`count(*) filter (where ${paid})`.mapWith(Number),
    })
    .from(schema.tenants)
    .where(and(isNull(schema.tenants.deletedAt), ne(schema.tenants.id, PACKS_TENANT_ID)))
    .groupBy(schema.tenants.acquiredVia, schema.tenants.acquiredCode)
    .orderBy(sql`count(*) desc`);
}
