/**
 * Adding a source to a watch profile.
 *
 * // TODO: security review — authorisation, accepts a URL that will be fetched
 */

import { AppError, isUuid, parseOrThrow } from "@mifluent/core";
import { createSource, sourceInputSchema } from "@mifluent/domain";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly profileId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "sources.created", status: 201 }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("profile:write");
    const { profileId } = await context.params;

    if (!isUuid(profileId)) {
      throw new AppError("not_found", "Not found.");
    }

    const input = parseOrThrow(sourceInputSchema, await readJsonBody(request));

    /*
     * The address is only checked for shape here. Whether it is safe to fetch
     * is decided at fetch time, on the resolved IP — see the note in
     * packages/sources/src/http. Checking it now and trusting it later is the
     * bug that check exists to prevent.
     */
    const id = await createSource({
      db: getDatabase(),
      tenantId: session.tenantId,
      profileId,
      input,
    });

    return { id };
  });
}
