/**
 * The owner's partner tools.
 *
 *   npm run partners:report                 — this month: earned, and unpaid in total
 *   npm run partners:report -- 2026-11      — that month
 *   npm run partners:add -- "Name" CODE [contact]
 *
 * Payouts are made by hand; the report says to whom and how much.
 */

import { addPartner, partnersReport } from "@mifluent/domain";
import { getDatabase } from "./runtime.js";

const [command, ...args] = process.argv.slice(2);
const db = getDatabase();

if (command === "add") {
  const [name, code, contact] = args;
  if (name === undefined || code === undefined) {
    process.stderr.write('Usage: npm run partners:add -- "Name" CODE [contact]\n');
    process.exit(1);
  }
  const created = await addPartner(db, { name, code, contact: contact ?? null });
  process.stdout.write(
    `Partner added. Code ${created.code}: −20% for 3 months to the buyer, 30% for 12 months to the partner.\n`,
  );
  process.exit(0);
}

const month = args[0] ?? new Date().toISOString().slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(month)) {
  process.stderr.write("Usage: npm run partners:report -- YYYY-MM\n");
  process.exit(1);
}
const from = new Date(`${month}-01T00:00:00Z`);
const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));

const rows = await partnersReport(db, from, to);
if (rows.length === 0) {
  process.stdout.write(`No partner earnings yet.\n`);
}
for (const row of rows) {
  const money = (minor: number) => `${(minor / 100).toFixed(2)} ${row.currency}`;
  process.stdout.write(
    `${row.name}${row.contact === null ? "" : ` (${row.contact})`}: ${month} — ${row.payments} payments, ${money(row.earnedMinor)} earned; unpaid in total ${money(row.unpaidMinor)}\n`,
  );
}
process.exit(0);
