/**
 * A new profile's first run, as counts — the onboarding progress screen.
 *
 * // TODO: security review — authorisation
 */

import { AppError, isUuid } from "@mifluent/core";
import { findWatchProfile, QUEUES, readProfileProgress } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { type JobState, readJob } from "@/lib/queue";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly profileId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "watch_profiles.progress_read" }, async () => {
    const session = await requireSessionWith("profile:read");
    const { profileId } = await context.params;

    if (!isUuid(profileId)) {
      throw new AppError("not_found", "Not found.");
    }

    const db = getDatabase();
    if ((await findWatchProfile(db, session.tenantId, profileId)) === undefined) {
      throw new AppError("not_found", "Not found.");
    }

    const runId = new URL(request.url).searchParams.get("runId");
    const job: JobState | null =
      runId !== null && isUuid(runId)
        ? (await readJob(QUEUES.profileFirstRun, runId, session.tenantId)).state
        : null;

    return { ...(await readProfileProgress(db, session.tenantId, profileId)), job };
  });
}
