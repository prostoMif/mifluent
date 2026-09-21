/**
 * Removing a source from a watch profile.
 *
 * // TODO: security review — authorisation
 */

import { AppError, isUuid } from "@mifluent/core";
import { deleteSource } from "@mifluent/domain";
import { route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly sourceId: string }>;
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "sources.deleted" }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("profile:write");
    const { sourceId } = await context.params;

    if (!isUuid(sourceId)) {
      throw new AppError("not_found", "Not found.");
    }

    await deleteSource(getDatabase(), session.tenantId, sourceId);

    return { id: sourceId };
  });
}
