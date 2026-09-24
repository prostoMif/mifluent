/**
 * A stand-in for a payment provider's webhook: set a tenant's plan.
 *
 * There is no payment integration yet (TASK-012 says: not now). Until there
 * is, a plan is changed by hand in the database or by calling this with the
 * shared secret. The body is exactly what a real provider's handler will end
 * up producing: which tenant, which plan.
 *
 * // TODO: security review — webhook authentication, payments
 */

import { AppError, getConfig, parseOrThrow } from "@mifluent/core";
import { PLAN_NAMES, setTenantPlan } from "@mifluent/domain";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { isSameSecret } from "@/lib/secrets";

const planChangeSchema = z.object({
  tenantId: z.string().uuid(),
  plan: z.enum(PLAN_NAMES),
});

export async function POST(request: Request): Promise<Response> {
  return route({ event: "billing.plan_changed" }, async () => {
    if (
      !isSameSecret(request.headers.get("x-billing-secret"), getConfig().BILLING_WEBHOOK_SECRET)
    ) {
      throw new AppError("not_found", "Not found.");
    }

    const change = parseOrThrow(planChangeSchema, await readJsonBody(request));
    await setTenantPlan(getDatabase(), change.tenantId, change.plan);
    return change;
  });
}
