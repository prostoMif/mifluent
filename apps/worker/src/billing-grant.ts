/**
 * Payments taken by hand — a ЮKassa payment link, a transfer — recorded so the
 * plan switches on and later off by itself.
 *
 *   npm run billing:grant                                   — the 20 newest sign-ups
 *   npm run billing:grant -- find <email | telegram id | name>
 *   npm run billing:grant -- <tenantId> <plan> <months> <roubles> [early]
 *
 * plan: starter | pro | team; months: 1 | 3 | 6 | 12; roubles: what was paid.
 * `early` counts the payment as one of the early Pro seats.
 */

import { isUuid } from "@mifluent/core";
import {
  findCustomers,
  grantManualPayment,
  PAID_PLANS,
  type PaidPlan,
  TERMS,
  type TermMonths,
} from "@mifluent/domain";
import { getDatabase, logger } from "./runtime.js";

const USAGE =
  "Usage:\n" +
  "  npm run billing:grant\n" +
  "  npm run billing:grant -- find <email | telegram id | name>\n" +
  "  npm run billing:grant -- <tenantId> <starter|pro|team> <1|3|6|12> <roubles> [early]\n";

const args = process.argv.slice(2);
const db = getDatabase();

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}`);
  process.exit(1);
}

function isPlan(value: string | undefined): value is PaidPlan {
  return PAID_PLANS.some((plan) => plan === value);
}

function toTerm(value: string | undefined): TermMonths | undefined {
  return TERMS.find((months) => String(months) === value);
}

if (args.length === 0 || args[0] === "find") {
  const rows = await findCustomers(db, args[1]);
  if (rows.length === 0) process.stdout.write("Nobody found.\n");
  for (const row of rows) {
    process.stdout.write(
      `${row.tenantId}  ${row.plan.padEnd(7)} ${row.createdAt.toISOString().slice(0, 16)}  ${row.name}  ${row.email}${row.telegramUserId === null ? "" : `  tg:${row.telegramUserId}`}\n`,
    );
  }
  process.exit(0);
}

const [tenantId, plan, monthsText, roublesText, earlyFlag] = args;
if (tenantId === undefined || !isUuid(tenantId)) fail("The first argument is the tenant id.");
if (!isPlan(plan)) fail("Plan must be starter, pro or team.");
const months = toTerm(monthsText);
if (months === undefined) fail("Months must be 1, 3, 6 or 12.");
const roubles = Number(roublesText);
if (!Number.isFinite(roubles) || roubles <= 0) fail("Roubles must be the amount paid, above 0.");

try {
  const orderId = await grantManualPayment(db, {
    tenantId,
    plan,
    months,
    amountMinor: Math.round(roubles * 100),
    currency: "RUB",
    isEarly: earlyFlag === "early",
  });
  process.stdout.write(`Done: ${plan} for ${months} mo, order ${orderId}.\n`);
  logger.info("billing.manual_payment_granted", { tenantId, plan, months, orderId });
  process.exit(0);
} catch (error) {
  logger.error("billing.manual_payment_failed", { tenantId, cause: error });
  process.stderr.write("Not applied — is the tenant id right?\n");
  process.exit(1);
}
