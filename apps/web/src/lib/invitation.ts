/**
 * Reading the invitation a browser is carrying.
 *
 * The problem this solves is small and easy to get wrong. Sign-up goes through
 * Better Auth's own endpoint, which knows nothing about invitations, and the
 * person filling in the form is not signed in and so has nowhere to keep
 * anything.
 *
 * The obvious shortcut is to key the invitation on the email address alone: the
 * sign-up request carries an email, so look for an outstanding invitation for
 * it. That is a hole — anybody who guessed which address the owner invited
 * could register as that person. The token has to be proved, not the address.
 *
 * So `/invite/<token>` checks the token, puts it in a cookie, and sends the
 * browser to the sign-up form. The cookie travels with the sign-up request and
 * is checked again there, against the email that was actually submitted.
 *
 * // TODO: security review — authentication
 */

import { cookies } from "next/headers";
import { INVITE_COOKIE_NAME } from "./invitation-cookie";

export { INVITE_COOKIE_MAX_AGE_SECONDS, INVITE_COOKIE_NAME } from "./invitation-cookie";

/** The token the browser is carrying, if it is carrying one. */
export async function readInviteToken(): Promise<string | undefined> {
  const value = (await cookies()).get(INVITE_COOKIE_NAME)?.value;
  return value === undefined || value === "" ? undefined : value;
}
