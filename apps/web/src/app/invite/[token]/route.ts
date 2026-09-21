/**
 * The address an invitation link points at.
 *
 * A route handler rather than a page, because it has to set a cookie and a
 * server component cannot. It checks the token, remembers it, and sends the
 * browser on to the sign-up form.
 *
 * The token never reaches the sign-up page as part of the address. Query
 * strings end up in browser history, in the referrer sent to the next site, and
 * in any proxy log along the way — none of which are places to leave something
 * that lets a stranger create an account.
 *
 * // TODO: security review — authentication
 */

import { getConfig } from "@mifluent/core";
import { findUsableInvitation } from "@mifluent/domain";
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import { INVITE_COOKIE_MAX_AGE_SECONDS, INVITE_COOKIE_NAME } from "@/lib/invitation-cookie";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly token: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  const invitation = await findUsableInvitation(getDatabase(), token);

  if (invitation === undefined) {
    logger.warn("invitations.link_refused", { reason: "expired, used or unknown" });
    return NextResponse.redirect(new URL("/invite-expired", request.url));
  }

  const response = NextResponse.redirect(new URL("/sign-up", request.url));

  response.cookies.set(INVITE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getConfig().isProduction,
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
