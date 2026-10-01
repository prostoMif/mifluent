/**
 * Stopping, or restarting, email digests for one profile.
 *
 * Two callers. A mail provider's one-click unsubscribe (RFC 8058) POSTs
 * `List-Unsubscribe=One-Click` here straight from the inbox and wants a plain
 * 200. The page at `/unsubscribe/<token>` posts its form here and wants to be
 * sent back to itself.
 *
 * No session and no origin check: the signed token is the authorisation.
 *
 * // TODO: security review — signed email links
 */

import { pauseEmailDelivery, resumeEmailDelivery } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { readUnsubscribeToken } from "@/lib/email-links";

interface RouteContext {
  readonly params: Promise<{ readonly token: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "email.unsubscribe_requested" }, async () => {
    const { token } = await context.params;
    const form = new URLSearchParams(await request.text());
    const isFromPage = form.get("from") === "page";
    const isResume = form.get("resume") === "1";
    const pageUrl = `/unsubscribe/${encodeURIComponent(token)}`;

    const profileId = readUnsubscribeToken(token);
    if (profileId === undefined) {
      return isFromPage
        ? new Response(null, { status: 303, headers: { Location: pageUrl } })
        : new Response(null, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date();
    if (isResume) {
      await resumeEmailDelivery(db, profileId, now);
    } else {
      await pauseEmailDelivery(db, profileId, now);
    }

    return isFromPage
      ? new Response(null, {
          status: 303,
          headers: { Location: `${pageUrl}?done=${isResume ? "resumed" : "paused"}` },
        })
      : new Response(null, { status: 200 });
  });
}
