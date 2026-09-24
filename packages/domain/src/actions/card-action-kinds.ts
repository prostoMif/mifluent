/**
 * The buttons under a card. Pure, so the web page can import the list.
 *
 * Two lists, because the surfaces differ. `CARD_ACTIONS` is what a press
 * records and nothing more, and the web page offers all of them.
 * `influenced` is Telegram-only: it records the press *and* asks a question,
 * and a web page with no answer box would collect the label without the line
 * that makes it worth having.
 */

export const CARD_ACTIONS = ["not_following_target", "not_important", "saved"] as const;

export type CardAction = (typeof CARD_ACTIONS)[number];

export function isCardAction(value: string): value is CardAction {
  return (CARD_ACTIONS as readonly string[]).includes(value);
}

/** "It changed a decision" — see `packages/domain/src/decisions`. */
export const INFLUENCED_ACTION = "influenced";

export const TELEGRAM_CARD_ACTIONS = [...CARD_ACTIONS, INFLUENCED_ACTION] as const;

export type TelegramCardAction = (typeof TELEGRAM_CARD_ACTIONS)[number];

export function isTelegramCardAction(value: string): value is TelegramCardAction {
  return (TELEGRAM_CARD_ACTIONS as readonly string[]).includes(value);
}
