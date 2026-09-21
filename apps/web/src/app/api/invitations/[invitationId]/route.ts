/**
 * Withdrawing an invitation that has not been used yet.
 *
 * // TODO: security review — authorisation
 */

import { AppError, isUuid } from "@mifluent/core";
import { revokeInvitation } from "@mifluent/domain";
import { route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly invitationId: string }>;
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "invitations.revoked" }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("member:manage");
    const { invitationId } = await context.params;

    // Checked before it reaches a query: a malformed identifier would otherwise
    // surface as a driver error about an invalid uuid.
    if (!isUuid(invitationId)) {
      throw new AppError("not_found", "Not found.");
    }

    await revokeInvitation(getDatabase(), session.tenantId, invitationId);

    return { id: invitationId };
  });
}
