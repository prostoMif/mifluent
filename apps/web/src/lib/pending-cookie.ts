/**
 * The anonymous visitor's onboarding is bound to the cookie set when they
 * started it. Every step after that checks the cookie names the same pending
 * row: knowing a pending id from a URL is not enough to read its discovery
 * or confirm it with your own email.
 *
 * // TODO: security review — anonymous onboarding
 */

import { AppError } from "@mifluent/core";
import { cookies } from "next/headers";

export const PENDING_COOKIE = "mifluent.pending";

export async function assertOwnsPending(pendingId: string): Promise<void> {
  const value = (await cookies()).get(PENDING_COOKIE)?.value;
  if (value === undefined || value !== pendingId) {
    throw new AppError("not_found", "This sign-up has expired. Start again.");
  }
}
