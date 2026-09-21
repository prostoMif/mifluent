/**
 * The name and lifetime of the cookie that carries an invitation token from the
 * link to the sign-up request.
 *
 * On its own, with no imports, because both a Next.js route handler and the
 * Better Auth instance need these — and the auth instance is also loaded by a
 * plain command-line script, where `next/headers` does not exist.
 */

export const INVITE_COOKIE_NAME = "mifluent.invite";

/** Long enough to fill in a form, short enough not to sit in a shared browser. */
export const INVITE_COOKIE_MAX_AGE_SECONDS = 60 * 60;
