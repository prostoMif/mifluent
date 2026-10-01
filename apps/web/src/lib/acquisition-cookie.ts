/**
 * The cookies that remember how a visitor arrived — a friend's link or a
 * promo code — until they sign up, which may be weeks later.
 *
 * On its own, with no imports, for the same reason as invitation-cookie.ts:
 * the Better Auth instance reads them and is also loaded outside Next.js.
 */

export const REFERRAL_COOKIE_NAME = "mifluent.ref";
export const PROMO_COOKIE_NAME = "mifluent.promo";

/** Ninety days: a code from a post is often used long after it was clicked. */
export const ACQUISITION_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
