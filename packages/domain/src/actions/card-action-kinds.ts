/**
 * The buttons under a card. Pure, so the web page can import the list.
 */

export const CARD_ACTIONS = [
  "not_following_target",
  "not_important",
  "saved",
  "influenced",
] as const;

export const CLICK_ACTIONS = ["opened_source"] as const;

export type CardAction = (typeof CARD_ACTIONS)[number];
export type ClickAction = (typeof CLICK_ACTIONS)[number];

export function isCardAction(value: string): value is CardAction {
  return (CARD_ACTIONS as readonly string[]).includes(value);
}

export function isClickAction(value: string): value is ClickAction {
  return (CLICK_ACTIONS as readonly string[]).includes(value);
}
