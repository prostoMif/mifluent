/**
 * Redirect route for tracking source clicks from Telegram and web.
 *
 * The card ID is a UUIDv7 — not guessable. Same 302 response for existing
 * and non-existing cards to avoid information leakage. Text fragment is preserved.
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

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "card.source_clicked", status: 302 }, async () => {
    const { cardId } = await context.params;
    if (!isUuid(cardId)) {
      return new Response(null, { status: 302, headers: { Location: "/" } });
    }

    const db = getDatabase();
    await recordClickAction(db, { cardId, action: "opened_source", surface: "web" });

    const sourceUrl = await getCardSourceUrl(db, cardId);
    const targetUrl = sourceUrl ?? "/";

    // Preserve text fragment from the incoming request
    const url = new URL(request.url);
    const fragment = url.hash;
    const redirectUrl = new URL(targetUrl);
    if (fragment) {
      redirectUrl.hash = fragment;
    }

    return new Response(null, {
      status: 302,
      headers: { Location: redirectUrl.toString() },
    });
  });
}
