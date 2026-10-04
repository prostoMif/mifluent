/**
 * Ask for a refund within the refund window. The money goes back by hand in
 * the ЮKassa dashboard; the owner is told here and confirms with
 * `npm run billing:refund -- <orderId>`.
 *
 * // TODO: security review — payments
 */

import { requestRefund } from "@mifluent/domain";
import { route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { tellOwner } from "@/lib/owner-notify";
import { requireSessionWith } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
  return route({ event: "billing.refund_requested", status: 201 }, async () => {
    assertSameOrigin(request);
    const session = await requireSessionWith("instance:manage");
    const refund = await requestRefund(getDatabase(), session.tenantId);

    await tellOwner(
      `Запрос возврата: ${(refund.amountMinor / 100).toFixed(2)} ${refund.currency}, заказ ${refund.orderId}.\n` +
        "Верни деньги в кабинете ЮKassa (если оплата была переводом по СБП — переводом " +
        `и аннулируй чек в «Мой налог»), затем: npm run billing:refund -- ${refund.orderId}`,
    );
    return { requested: true };
  });
}
