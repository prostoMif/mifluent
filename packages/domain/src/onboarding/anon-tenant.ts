/**
 * A service tenant for work done before a visitor has an account: discovery
 * on the start page. Its only job is to carry the model costs of those runs,
 * so the daily cost cap counts them; it has no members, profiles or sources.
 *
 * A fixed id, like the packs tenant, so every instance agrees on it.
 */

import type { Queryable } from "@mifluent/db";
import { schema } from "@mifluent/db";

export const ANON_TENANT_ID = "00000000-0000-7000-8000-00000000ac03";

export async function ensureAnonTenant(db: Queryable): Promise<void> {
  await db
    .insert(schema.tenants)
    .values({ id: ANON_TENANT_ID, name: "Mifluent visitors (before sign-up)", timezone: "UTC" })
    .onConflictDoNothing();
}
