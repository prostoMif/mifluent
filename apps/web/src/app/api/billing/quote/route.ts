/**
 * What the signed-in tenant would pay for each plan on one term: the code it
 * typed or arrived with and any running campaign included. The same function
 * the checkout charges with, so the page and the payment agree.
 *
 * A code that gives free days rather than money off (SELFHOST) is redeemed
 * here, when it is typed.
 *
 * // TODO: security review — payments
 */

import { getConfig, isAppError, parseOrThrow } from "@mifluent/core";
import {
  CURRENCIES,
  findPromo,
  normalizeCode,
  PAID_PLANS,
  quoteFor,
  redeemTrialCode,
} from "@mifluent/domain";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

const quoteSchema = z.object({
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  currency: z.enum(CURRENCIES),
  promoCode: z.string().max(64).optional(),
});

interface PlanQuote {
  readonly amountMinor: number;
  readonly appliedCode: string | null;
  /** Why the typed code does not apply to this plan, when it does not. */
  readonly codeError: string | null;
}

export async function POST(request: Request): Promise<Response> {
  return route({ event: "billing.quoted" }, async () => {
    assertSameOrigin(request);
    const session = await requireSessionWith("instance:manage");
    const input = parseOrThrow(quoteSchema, await readJsonBody(request));
    const db = getDatabase();
    const now = new Date();

    const code = normalizeCode(input.promoCode);
    const promo = code === undefined ? undefined : await findPromo(db, code);
    let trialEndsAt: Date | null = null;
    let typedCode = input.promoCode?.trim() === "" ? undefined : input.promoCode;
    if (promo?.trialDays != null && code !== undefined) {
      trialEndsAt = await redeemTrialCode(db, session.tenantId, code, now);
      typedCode = undefined;
    }

    const quotes: Record<string, PlanQuote> = {};
    for (const plan of PAID_PLANS) {
      quotes[plan] = await quotePlan({
        tenantId: session.tenantId,
        plan,
        months: input.months,
        currency: input.currency,
        earlySeats: getConfig().EARLY_SEATS,
        now,
        promoCode: typedCode,
      });
    }
    return { quotes, trialEndsAt };
  });
}

/** One plan's price; a code that does not fit this plan is reported, and the price shown without it. */
async function quotePlan(input: Parameters<typeof quoteFor>[1]): Promise<PlanQuote> {
  try {
    const price = await quoteFor(getDatabase(), input);
    return { amountMinor: price.amountMinor, appliedCode: price.appliedCode, codeError: null };
  } catch (thrown) {
    if (!isAppError(thrown) || thrown.code !== "promo_code_invalid") throw thrown;
    const price = await quoteFor(getDatabase(), { ...input, promoCode: undefined });
    return {
      amountMinor: price.amountMinor,
      appliedCode: price.appliedCode,
      codeError: thrown.message,
    };
  }
}
