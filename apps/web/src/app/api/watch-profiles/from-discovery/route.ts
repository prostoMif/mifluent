/**
 * Creating a profile from what onboarding found, and starting its first run.
 *
 * // TODO: security review — authorisation; accepts URLs that will be fetched
 */

import { parseOrThrow } from "@mifluent/core";
import { createProfileFromDiscovery, profileFromDiscoverySchema, QUEUES } from "@mifluent/domain";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { sendInteractiveJob } from "@/lib/queue";
import { requireSessionWith } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
  return route({ event: "watch_profiles.created_from_discovery", status: 201 }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("profile:write");
    const input = parseOrThrow(profileFromDiscoverySchema, await readJsonBody(request));

    const { profileId } = await createProfileFromDiscovery({
      db: getDatabase(),
      tenantId: session.tenantId,
      input,
    });
    const runId = await sendInteractiveJob(QUEUES.profileFirstRun, {
      tenantId: session.tenantId,
      profileId,
    });

    return { profileId, runId };
  });
}
