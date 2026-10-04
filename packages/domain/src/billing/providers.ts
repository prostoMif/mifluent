/**
 * Who took the money for an order.
 *
 * - `yookassa` — a payment made on the site through ЮKassa;
 * - `manual` — a payment the owner took by hand (СБП transfer, a ЮKassa
 *   payment link) and recorded with `npm run billing:grant`;
 * - `referral`, `bug_bounty` — free time, no money changed hands.
 *
 * Refunds, the win-back offer and acquisition reports care about orders that
 * were actually paid for, which is this list.
 */
export const MONEY_PROVIDERS = ["yookassa", "manual"] as const;

export type MoneyProvider = (typeof MONEY_PROVIDERS)[number];

/** The provider recorded on an order created by the site's checkout. */
export const CHECKOUT_PROVIDER: MoneyProvider = "yookassa";
