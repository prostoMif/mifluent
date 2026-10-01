/**
 * Reading the signed tokens in digest email links.
 *
 * The token is the whole authorisation of `/a/<token>` and
 * `/unsubscribe/<token>`: whoever holds the email holds the link. A bad,
 * tampered or expired token reads as `undefined` and every caller shows the
 * same "this link no longer works" — no detail about why.
 *
 * // TODO: security review — signed email links
 */

import { getConfig } from "@mifluent/core";
import { email } from "@mifluent/delivery";
import { type CardAction, isCardAction } from "@mifluent/domain";

export interface EmailAction {
  readonly cardId: string;
  readonly action: CardAction;
}

function secret(): string {
  return email.emailLinkSecret(getConfig());
}

export function readActionToken(token: string): EmailAction | undefined {
  try {
    const { cardId, action } = email.parseActionToken(secret(), decodeURIComponent(token));
    return isCardAction(action) ? { cardId, action } : undefined;
  } catch {
    return undefined;
  }
}

export function readUnsubscribeToken(token: string): string | undefined {
  try {
    return email.parseUnsubscribeToken(secret(), decodeURIComponent(token)).profileId;
  } catch {
    return undefined;
  }
}

/** Email pages are opened without a session, so the browser's language decides. */
export function languageOf(acceptLanguage: string | null): "en" | "ru" {
  return (acceptLanguage ?? "").toLowerCase().startsWith("ru") ? "ru" : "en";
}
