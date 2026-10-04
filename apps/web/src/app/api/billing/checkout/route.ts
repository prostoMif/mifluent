/**
 * Start a payment: create our order at today's price, create the ЮKassa
 * payment for exactly that amount, and hand back the link to its payment page.
 *
 * // TODO: security review — payments
 */

import { AppError, getConfig, parseOrThrow } from "@mifluent/core";
import { CURRENCIES, createOrder, PAID_PLANS } from "@mifluent/domain";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import { createPayment, yookassaCredentials } from "@/lib/yookassa";

const checkoutSchema = z.object({
  plan: z.enum(PAID_PLANS),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  currency: z.enum(CURRENCIES),
  promoCode: z.string().max(64).optional(),
});

const PLAN_TITLES = { starter: "Старт", pro: "Pro", team: "Команда" } as const;

export async function POST(request: Request): Promise<Response> {
  return route({ event: "billing.checkout_started", status: 201 }, async () => {
    assertSameOrigin(request);
    const session = await requireSessionWith("instance:manage");
    const input = parseOrThrow(checkoutSchema, await readJsonBody(request));
    const config = getConfig();

    const credentials = yookassaCredentials(config);
    if (credentials === undefined) {
      throw new AppError("payment_not_configured", "Payments are not switched on yet.");
    }
    if (input.currency === "USD" && !config.YOOKASSA_ALLOW_USD) {
      throw new AppError("payment_not_configured", "Payments in dollars are not available yet.");
    }

    const { orderId, quote } = await createOrder(getDatabase(), {
      tenantId: session.tenantId,
      plan: input.plan,
      months: input.months,
      currency: input.currency,
      earlySeats: config.EARLY_SEATS,
      promoCode: input.promoCode?.trim() === "" ? undefined : input.promoCode,
    });

    const { confirmationUrl } = await createPayment(credentials, {
      orderId,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      description: `Mifluent ${PLAN_TITLES[quote.plan]}, ${quote.months} мес., заказ ${orderId}`,
      returnUrl: `${config.APP_URL}/settings?paid=1`,
    });
    return {
      orderId,
      url: confirmationUrl,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
    };
  });
}
