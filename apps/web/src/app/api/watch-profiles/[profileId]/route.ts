/**
 * Saving and removing one watch profile.
 *
 * The identifier arrives in the path, which makes this the classic place to
 * hand back somebody else's object. It never happens here because the tenant
 * from the session is passed into every query, and a row belonging to another
 * tenant simply does not match — the caller is told "not found", which is also
 * true from where they are standing.
 *
 * // TODO: security review — authorisation
 */

import { AppError, isUuid, parseOrThrow } from "@mifluent/core";
import { deleteWatchProfile, saveWatchProfile, watchProfileInputSchema } from "@mifluent/domain";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly profileId: string }>;
}

async function readProfileId(context: RouteContext): Promise<string> {
  const { profileId } = await context.params;

  // Checked before it reaches a query. A malformed identifier would otherwise
  // surface as a driver error about an invalid uuid, which is exactly the kind
  // of internal detail that must not cross the boundary.
  if (!isUuid(profileId)) {
    throw new AppError("not_found", "Not found.");
  }

  return profileId;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "watch_profiles.saved" }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("profile:write");
    const profileId = await readProfileId(context);
    const input = parseOrThrow(watchProfileInputSchema, await readJsonBody(request));

    return saveWatchProfile({
      db: getDatabase(),
      tenantId: session.tenantId,
      profileId,
      input,
    });
  });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "watch_profiles.deleted" }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("profile:write");
    const profileId = await readProfileId(context);

    await deleteWatchProfile(getDatabase(), session.tenantId, profileId);

    return { id: profileId };
  });
}
