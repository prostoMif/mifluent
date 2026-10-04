/** The tenant's plan, trial and paid time, and the early seats left — for the pricing and settings pages. */

import { getConfig } from "@mifluent/core";
import { findTenantPlan, getBillingStatus } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { isPaymentEnabled } from "@/lib/yookassa";

export async function GET(): Promise<Response> {
  return route({ event: "billing.status_read" }, async () => {
    const session = await requireSession();
    const db = getDatabase();
    const config = getConfig();

    return {
      ...(await getBillingStatus(db, session.tenantId, config.EARLY_SEATS)),
      effectivePlan: (await findTenantPlan(db, session.tenantId)).name,
      isPaymentEnabled: isPaymentEnabled(config),
      isDollarPaymentEnabled: config.YOOKASSA_ALLOW_USD,
    };
  });
}
