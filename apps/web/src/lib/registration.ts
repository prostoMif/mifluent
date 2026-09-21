/**
 * Whether the sign-up screen should be reachable, and in which shape.
 *
 * This is only for deciding what to render. It is not the control — the real
 * refusal happens in the Better Auth hook in `auth.ts`, on the server, on the
 * request that actually creates the account. Hiding a form is not a permission
 * check, and a page that only hid it would be wide open to anyone who typed the
 * address.
 */

import { getConfig } from "@mifluent/core";
import { assertRegistrationAllowed, findUsableInvitation, hasAnyAccount } from "@mifluent/domain";
import { getDatabase } from "./db";
import { readInviteToken } from "./invitation";

export interface SignUpAvailability {
  readonly isOpen: boolean;
  /** True when nobody has registered yet: this account will own the instance. */
  readonly isClaimingInstance: boolean;
  /**
   * The address this browser was invited under, when it is carrying a valid
   * invitation. The form locks the field to it — the invitation is for one
   * named person, and letting the address be edited would make it for anyone.
   */
  readonly invitedEmail?: string | undefined;
}

export async function getSignUpAvailability(): Promise<SignUpAvailability> {
  const isTaken = await hasAnyAccount(getDatabase());
  const invitation = await findInvitation();

  try {
    assertRegistrationAllowed({
      hasAnyAccount: isTaken,
      isRegistrationOpen: getConfig().REGISTRATION_OPEN,
      hasValidInvitation: invitation !== undefined,
    });
  } catch {
    return { isOpen: false, isClaimingInstance: false };
  }

  return {
    isOpen: true,
    isClaimingInstance: !isTaken,
    ...(invitation === undefined ? {} : { invitedEmail: invitation.email }),
  };
}

export async function isSignUpOpen(): Promise<boolean> {
  return (await getSignUpAvailability()).isOpen;
}

async function findInvitation() {
  const token = await readInviteToken();

  if (token === undefined) {
    return undefined;
  }

  return findUsableInvitation(getDatabase(), token);
}
