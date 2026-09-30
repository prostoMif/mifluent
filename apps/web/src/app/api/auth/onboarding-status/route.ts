/**
 * Check onboarding status after magic link verification.
 *
 * Returns profileId once the after hook has completed.
 */

import { schema } from "@mifluent/db";
import { and, eq, isNull } from "drizzle-orm";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { requireSession } from "@/lib/session";

export async function GET(request: Request): Promise<Response> {
  return route({ event: "onboarding.status_check" }, async () => {
    const session = await requireSession();
    const { searchParams } = new URL(request.url);
    const pending = searchParams.get("pending");

    if (!pending) {
      return { error: "No pending ID" };
    }

    const db = getDatabase();

    // Check if pending onboarding is consumed
    const [pendingRow] = await db
      .select({ consumedAt: schema.pendingOnboardings.consumedAt })
      .from(schema.pendingOnboardings)
      .where(eq(schema.pendingOnboardings.id, pending))
      .limit(1);

    if (!pendingRow?.consumedAt) {
      return { profileId: null, runId: null };
    }

    // Find the profile created for this user
    const [profile] = await db
      .select({ id: schema.watchProfiles.id })
      .from(schema.watchProfiles)
      .where(
        and(
          eq(schema.watchProfiles.tenantId, session.tenantId),
          isNull(schema.watchProfiles.deletedAt),
        ),
      )
      .orderBy(schema.watchProfiles.createdAt)
      .limit(1);

    if (!profile) {
      return { error: "Profile not found" };
    }

    // No profileRuns table - just return a placeholder runId
    // The FirstRunProgress component will poll the progress endpoint directly
    return { profileId: profile.id, runId: "first-run" };
  });
}
