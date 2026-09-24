/**
 * The three buttons under a card on the web: not following, not important,
 * save. The same record as a press in Telegram.
 *
 * // TODO: security review — authorisation
 */

import { AppError, isUuid, parseOrThrow } from "@mifluent/core";
import { CARD_ACTIONS, recordCardAction } from "@mifluent/domain";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly cardId: string }>;
}

const actionSchema = z.object({ action: z.enum(CARD_ACTIONS) });

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "cards.acted_on", status: 201 }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("digest:read");
    const { cardId } = await context.params;
    if (!isUuid(cardId)) {
      throw new AppError("not_found", "Not found.");
    }

    const { action } = parseOrThrow(actionSchema, await readJsonBody(request));

    // Scoped by the session's tenant inside: a card from another tenant is
    // "not found", the same as one that does not exist.
    await recordCardAction(getDatabase(), {
      tenantId: session.tenantId,
      cardId,
      action,
      surface: "web",
      userId: session.userId,
    });
    return { action };
  });
}
