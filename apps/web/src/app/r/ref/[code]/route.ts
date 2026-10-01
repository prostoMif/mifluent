/**
 * A friend's invite link: remember the code, then show the start page.
 *
 * Nothing is checked or granted here. The code is checked at sign-up, where a
 * self-invite or an unknown code simply counts as an ordinary sign-up.
 */

import { normalizeCode } from "@mifluent/domain";
import { ACQUISITION_COOKIE_MAX_AGE_SECONDS, REFERRAL_COOKIE_NAME } from "@/lib/acquisition-cookie";
import { rememberAndRedirect } from "@/lib/acquisition-link";

interface RouteContext {
  readonly params: Promise<{ readonly code: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const code = normalizeCode((await context.params).code);
  return rememberAndRedirect({
    cookieName: REFERRAL_COOKIE_NAME,
    code,
    maxAgeSeconds: ACQUISITION_COOKIE_MAX_AGE_SECONDS,
    location: "/start",
  });
}
