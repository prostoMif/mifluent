/**
 * Creating an invitation.
 *
 * The token comes back in the response and is never stored in readable form, so
 * this is the only moment the link exists. Losing it means issuing a new
 * invitation, which is the correct answer rather than a limitation.
 *
 * // TODO: security review — authorisation, authentication
 */

import { parseOrThrow } from "@mifluent/core";
import { createInvitation, MEMBER_ROLES } from "@mifluent/domain";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

const createSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter an email address.")),
  role: z.enum(MEMBER_ROLES),
});

export async function POST(request: Request): Promise<Response> {
  return route({ event: "invitations.created", status: 201 }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("member:manage");
    const input = parseOrThrow(createSchema, await readJsonBody(request));

    const created = await createInvitation({
      db: getDatabase(),
      tenantId: session.tenantId,
      email: input.email,
      role: input.role,
      invitedByUserId: session.userId,
    });

    return {
      id: created.invitation.id,
      email: created.invitation.email,
      role: created.invitation.role,
      expiresAt: created.invitation.expiresAt.toISOString(),
      /*
       * A path, not a whole address. The instance does not reliably know how it
       * is reached — behind a proxy, on a local network, under somebody's own
       * domain — and a link built from a guess is a link that does not work.
       * The browser knows, so it joins the two.
       */
      invitePath: `/invite/${created.token}`,
    };
  });
}
