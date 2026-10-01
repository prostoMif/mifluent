/**
 * Where the visitor's discovery has got to. Read by the progress screen
 * before there is any account, so it is bound to the pending cookie instead
 * of a session.
 */

import { AppError, isUuid } from "@mifluent/core";
import { getPendingOnboarding } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { assertOwnsPending } from "@/lib/pending-cookie";

export async function GET(request: Request): Promise<Response> {
  return route({ event: "onboarding.status_read" }, async () => {
    const pendingId = new URL(request.url).searchParams.get("pending") ?? "";
    if (!isUuid(pendingId)) throw new AppError("not_found", "Not found.");
    await assertOwnsPending(pendingId);

    const pending = await getPendingOnboarding(getDatabase(), pendingId);
    if (pending === undefined) return { state: "expired" as const, error: null };
    if (pending.result !== null) return { state: "completed" as const, error: null };
    if (pending.discoveryError !== null) {
      return { state: "failed" as const, error: pending.discoveryError };
    }
    return { state: "running" as const, error: null };
  });
}
