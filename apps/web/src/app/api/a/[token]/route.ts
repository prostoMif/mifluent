/**
 * The press behind an email button, sent from the confirmation page at
 * `/a/<token>`.
 *
 * POST, never GET: mail scanners and link previewers open every link in a
 * message, and a GET that paused a target would pause it before the reader
 * saw the email. The page asks; only its form gets here.
 *
 * No session and no origin check: the signed token is the authorisation, and
 * anyone holding it could send this request from anywhere anyway.
 *
 * // TODO: security review — signed email links
 */

import { recordEmailCardAction } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { readActionToken } from "@/lib/email-links";

interface RouteContext {
  readonly params: Promise<{ readonly token: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "cards.acted_on_by_email" }, async () => {
    const { token } = await context.params;
    const parsed = readActionToken(token);
    // Unknown card or bad token: back to the page, which says the link no
    // longer works. The same answer for both.
    const isDone =
      parsed !== undefined &&
      (await recordEmailCardAction(getDatabase(), parsed.cardId, parsed.action));

    return new Response(null, {
      status: 303,
      headers: { Location: `/a/${encodeURIComponent(token)}${isDone ? "?done=1" : ""}` },
    });
  });
}
