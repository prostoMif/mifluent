/**
 * Who to re-run selection for after pack material arrives.
 *
 * Instance-wide, like the digest scheduler's "who is due": new pack material
 * may matter to any profile, and which ones is decided per profile by
 * `matchPacks` when its selection runs. A profile that follows no pack finds
 * no pack candidates and costs one cheap query.
 */

import { type Queryable, schema } from "@mifluent/db";
import { and, isNotNull, isNull, ne } from "drizzle-orm";
import { PACKS_TENANT_ID } from "./tenant.js";

export interface PackFanoutProfile {
  readonly tenantId: string;
  readonly profileId: string;
}

export async function listProfilesForPackMaterial(db: Queryable): Promise<PackFanoutProfile[]> {
  return db
    .select({ tenantId: schema.watchProfiles.tenantId, profileId: schema.watchProfiles.id })
    .from(schema.watchProfiles)
    .where(
      and(
        isNull(schema.watchProfiles.deletedAt),
        isNotNull(schema.watchProfiles.currentVersionId),
        ne(schema.watchProfiles.tenantId, PACKS_TENANT_ID),
      ),
    );
}
