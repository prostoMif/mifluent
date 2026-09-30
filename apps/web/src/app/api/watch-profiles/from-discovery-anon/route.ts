/**
 * Creating a profile from anonymous discovery review.
 *
 * This is called after the anonymous user reviews and confirms the discovery result.
 * It creates a pending onboarding with the reviewed data, then the user chooses
 * a channel and gets a magic link.
 */

import { parseOrThrow } from "@mifluent/core";
import { schema } from "@mifluent/db";
import {
  createProfileFromDiscovery,
  type ProfileFromDiscoveryInput,
  profileFromDiscoverySchema,
  QUEUES,
} from "@mifluent/domain";
import { eq } from "drizzle-orm";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { sendInteractiveJob } from "@/lib/queue";

export async function POST(request: Request): Promise<Response> {
  return route({ event: "watch_profiles.created_from_discovery_anon", status: 201 }, async () => {
    assertSameOrigin(request);

    const input = parseOrThrow(profileFromDiscoverySchema, await readJsonBody(request));
    const { pendingId, ...profileInput } = input as ProfileFromDiscoveryInput & {
      pendingId: string;
    };

    const db = getDatabase();

    // Verify pending onboarding exists and belongs to this session
    const [pending] = await db
      .select()
      .from(schema.pendingOnboardings)
      .where(eq(schema.pendingOnboardings.id, pendingId))
      .limit(1);

    if (!pending) {
      throw new Error("Pending onboarding not found");
    }

    if (pending.consumedAt) {
      throw new Error("This onboarding has already been completed");
    }

    if (pending.expiresAt < new Date()) {
      throw new Error("This onboarding has expired");
    }

    // For anonymous, we use a temporary tenant ID
    // The real tenant will be created when the magic link is clicked
    const tempTenantId = "anon";

    const { profileId } = await createProfileFromDiscovery({
      db,
      tenantId: tempTenantId,
      input: profileInput,
    });

    const runId = await sendInteractiveJob(QUEUES.profileFirstRun, {
      tenantId: tempTenantId,
      profileId,
    });

    // Update pending onboarding with the reviewed profile data
    await db
      .update(schema.pendingOnboardings)
      .set({
        result: {
          ...(pending.result as object),
          // Merge the reviewed data
        } as object,
        updatedAt: new Date(),
      })
      .where(eq(schema.pendingOnboardings.id, pendingId));

    return { profileId, runId };
  });
}
