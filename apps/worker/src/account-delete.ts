/**
 * Erase a customer's business and data on their request — what the privacy
 * policy promises within 30 days of being asked.
 *
 *   npm run account:delete -- find <email | telegram id | name>
 *   npm run account:delete -- <tenantId> --yes
 *
 * Irreversible. The first form only lists matches; the second needs `--yes`.
 * Take a backup first if in doubt (`docker compose exec backup mifluent-backup`).
 */

import { isUuid } from "@mifluent/core";
import { eraseTenant, findCustomers } from "@mifluent/domain";
import { getDatabase, logger } from "./runtime.js";

const USAGE =
  "Usage:\n" +
  "  npm run account:delete -- find <email | telegram id | name>\n" +
  "  npm run account:delete -- <tenantId> --yes\n";

const args = process.argv.slice(2);
const db = getDatabase();

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [first, second] = args;
  if (first === "find") {
    const rows = await findCustomers(db, second);
    for (const row of rows) {
      process.stdout.write(
        `${row.tenantId}  ${row.plan.padEnd(7)}  ${row.email}  tg:${row.telegramUserId ?? "-"}  ${row.name}\n`,
      );
    }
    if (rows.length === 0) process.stdout.write("Nothing found.\n");
    return;
  }

  if (first === undefined || !isUuid(first)) fail("Give a tenant id.");
  if (second !== "--yes") fail("Erasing is irreversible: add --yes to confirm.");

  const result = await eraseTenant(db, first);
  logger.info("tenant.erased", { tenantId: result.tenantId, usersErased: result.usersErased });
  process.stdout.write(
    `Erased tenant ${result.tenantId} and ${result.usersErased} user(s) who belonged only to it.\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.error("tenant.erase_failed", { cause: error });
    process.exit(1);
  });
