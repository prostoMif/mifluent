/**
 * Redirect route for tracking source clicks from Telegram and web.
 *
 * The card ID is a UUIDv7 — not guessable. Same 302 response for existing
 * and non-existing cards to avoid information leakage.
 *
 * // TODO: security review — unscoped card read
 */

import { isUuid } from "@mifluent/core";
import { getCardSourceUrl, recordClickAction } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";

interface RouteContext {
  readonly params: Promise<{ readonly cardId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "card.source_clicked", status: 302 }, async () => {
    const { cardId } = await context.params;
    if (!isUuid(cardId)) {
      return new Response(null, { status: 302, headers: { Location: "/" } });
    }

    const db = getDatabase();
    await recordClickAction(db, { cardId, action: "opened_source", surface: "web" });

    // The text fragment (#:~:text=…) is part of the stored URL: a browser never
    // sends the fragment of the link it followed, so there is none to copy.
    const sourceUrl = await getCardSourceUrl(db, cardId);
    return new Response(null, { status: 302, headers: { Location: sourceUrl ?? "/" } });
  });
}
