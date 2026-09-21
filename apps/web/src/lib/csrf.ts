/**
 * The origin check on state-changing requests.
 *
 * `SameSite=lax` on the session cookie already stops a cross-site form post
 * from carrying the session, so this is the second lock rather than the first.
 * It is here because the first one is set in one place and applies everywhere,
 * which makes it exactly the kind of protection that quietly disappears when
 * somebody loosens a cookie attribute for an unrelated reason.
 *
 * Browsers send `Origin` on every fetch that changes something, and a missing
 * header is treated as a refusal rather than as permission — a check that
 * passes when the evidence is absent is not a check.
 *
 * // TODO: security review — request forgery
 */

import { AppError, getConfig } from "@mifluent/core";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");

  if (origin === null) {
    throw new AppError("forbidden", "This request could not be verified.", {
      reason: "no origin header",
    });
  }

  if (origin !== new URL(getConfig().APP_URL).origin) {
    throw new AppError("forbidden", "This request could not be verified.", {
      reason: "origin did not match APP_URL",
      origin,
    });
  }
}
