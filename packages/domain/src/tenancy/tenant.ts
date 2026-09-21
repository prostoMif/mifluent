/**
 * Reading and renaming the tenant itself.
 *
 * Everything here takes the tenant identifier from the session, never from a
 * request. That is the whole reason these are functions rather than inline
 * queries: a caller cannot supply the tenant it wants to look at.
 */

import { type Queryable, schema } from "@mifluent/db";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantSettingsInput } from "./tenant-schemas.js";

export interface Tenant {
  readonly id: string;
  readonly name: string;
  /** IANA zone. Used only to render times; storage stays UTC. */
  readonly timezone: string;
}

export async function findTenant(db: Queryable, tenantId: string): Promise<Tenant | undefined> {
  const [row] = await db
    .select({
      id: schema.tenants.id,
      name: schema.tenants.name,
      timezone: schema.tenants.timezone,
    })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)))
    .limit(1);

  return row;
}

export async function updateTenantSettings(
  db: Queryable,
  tenantId: string,
  settings: TenantSettingsInput,
): Promise<void> {
  await db
    .update(schema.tenants)
    .set({ name: settings.name, timezone: settings.timezone, updatedAt: new Date() })
    .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)));
}
