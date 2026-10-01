/**
 * Start a payment: create our order at today's price, and hand back the link
 * to the provider's payment page.
 *
 * // TODO: security review — payments
 */

import { AppError, getConfig, parseOrThrow } from "@mifluent/core";
import { CURRENCIES, createOrder, PAID_PLANS } from "@mifluent/domain";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { buildPaymentLink } from "@/lib/prodamus";
import { requireSessionWith } from "@/lib/session";

const checkoutSchema = z.object({
  plan: z.enum(PAID_PLANS),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  currency: z.enum(CURRENCIES),
  promoCode: z.string().max(64).optional(),
});

const PLAN_TITLES = { starter: "Starter", pro: "Pro", team: "Team" } as const;

export async function POST(request: Request): Promise<Response> {
  return route({ event: "billing.checkout_started", status: 201 }, async () => {
    assertSameOrigin(request);
    const session = await requireSessionWith("instance:manage");
    const input = parseOrThrow(checkoutSchema, await readJsonBody(request));
    const config = getConfig();

    if (config.PRODAMUS_URL === undefined || config.PRODAMUS_SECRET === undefined) {
      throw new AppError("payment_not_configured", "Payments are not switched on yet.");
    }
    if (input.currency === "USD" && !config.PRODAMUS_FOREIGN_CARDS) {
      throw new AppError(
        "payment_not_configured",
        "Card payments in dollars are not available yet.",
      );
    }

    const { orderId, quote } = await createOrder(getDatabase(), {
      tenantId: session.tenantId,
      plan: input.plan,
      months: input.months,
      currency: input.currency,
      earlySeats: config.EARLY_SEATS,
      promoCode: input.promoCode?.trim() === "" ? undefined : input.promoCode,
    });

    const url = buildPaymentLink({
      shopUrl: config.PRODAMUS_URL,
      orderId,
      amount: quote.amountMinor / 100,
      productName: `Mifluent ${PLAN_TITLES[quote.plan]}, ${quote.months} mo`,
      customerEmail: session.email,
      notificationUrl: `${config.APP_URL}/api/billing/prodamus`,
      successUrl: `${config.APP_URL}/settings?paid=1`,
      returnUrl: `${config.APP_URL}/pricing`,
    });
    return { orderId, url, amountMinor: quote.amountMinor, currency: quote.currency };
  });
}
