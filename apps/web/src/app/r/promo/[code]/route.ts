/**
 * A promo link from a post or a partner: remember the code, then show the
 * prices with it filled in. It is checked at checkout, against the plan and
 * term actually chosen.
 */

import { normalizeCode } from "@mifluent/domain";
import { ACQUISITION_COOKIE_MAX_AGE_SECONDS, PROMO_COOKIE_NAME } from "@/lib/acquisition-cookie";
import { rememberAndRedirect } from "@/lib/acquisition-link";

interface RouteContext {
  readonly params: Promise<{ readonly code: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const code = normalizeCode((await context.params).code);
  return rememberAndRedirect({
    cookieName: PROMO_COOKIE_NAME,
    code,
    maxAgeSeconds: ACQUISITION_COOKIE_MAX_AGE_SECONDS,
    location: code === undefined ? "/pricing" : `/pricing?code=${encodeURIComponent(code)}`,
  });
}
