/**
 * Creating a watch profile.
 *
 * // TODO: security review — authorisation
 */

import { parseOrThrow } from "@mifluent/core";
import { createWatchProfile, watchProfileInputSchema } from "@mifluent/domain";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
  return route({ event: "watch_profiles.created", status: 201 }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("profile:write");
    const input = parseOrThrow(watchProfileInputSchema, await readJsonBody(request));

    return createWatchProfile({
      db: getDatabase(),
      tenantId: session.tenantId,
      input,
    });
  });
}
