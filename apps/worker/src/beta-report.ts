/**
 * Beta report CLI: `npm run beta:report`
 * Prints a table of all tenants with their beta metrics and returner status.
 */

import { getConfig } from "@mifluent/core";
import { createDatabase } from "@mifluent/db";
import { type BetaReportRow, generateBetaReport } from "@mifluent/domain";
import { logger } from "./runtime.js";

interface CliOptions {
  csv: boolean;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: CliOptions = { csv: args.includes("--csv") };

  const config = getConfig();
  const db = createDatabase({ connectionString: config.DATABASE_URL, maxConnections: 2 });

  try {
    logger.info("beta.report.started", {});

    const rows = await generateBetaReport(db);

    if (options.csv) {
      printCsv(rows);
    } else {
      printTable(rows);
    }

    const returners = rows.filter((r: BetaReportRow) => r.isReturner).length;
    const total = rows.length;
    const pct = total > 0 ? Math.round((returners / total) * 100) : 0;

    process.stdout.write(`\nReturners: ${returners}/${total} (${pct}%)\n`);

    logger.info("beta.report.completed", { total: rows.length, returners });
  } catch (thrown) {
    logger.error("beta.report.failed", { cause: thrown });
    process.exit(1);
  } finally {
    await db.$client?.end?.();
  }
}

function printTable(rows: BetaReportRow[]): void {
  if (rows.length === 0) {
    process.stdout.write("No tenants found.\n");
    return;
  }

  const cols = [
    { key: "tenantId", label: "Tenant", width: 26 },
    { key: "onboardedAt", label: "Onboarded", width: 10 },
    { key: "channel", label: "Ch", width: 3 },
    { key: "daysInProduct", label: "Days", width: 4 },
    { key: "digestsDelivered", label: "Digests", width: 7 },
    { key: "activeDays", label: "Active", width: 6 },
    { key: "totalInfluenced", label: "Infl.", width: 5 },
    { key: "botBlocked", label: "Blocked", width: 7 },
    { key: "lastActiveAt", label: "Last Act.", width: 10 },
    { key: "isReturner", label: "Returner", width: 8 },
  ];

  // Header
  const header = cols.map((c) => c.label.padEnd(c.width)).join(" | ");
  const sep = cols.map((c) => "-".repeat(c.width)).join("-+-");
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${sep}\n`);

  for (const row of rows) {
    const line = cols.map((c) => formatCell(row, c.key).padEnd(c.width)).join(" | ");
    process.stdout.write(`${line}\n`);
  }
}

function formatCell(row: BetaReportRow, key: string): string {
  if (key === "onboardedAt") {
    return row.onboardedAt.toISOString().split("T")[0] ?? "";
  }
  if (key === "lastActiveAt") {
    return row.lastActiveAt ? (row.lastActiveAt.toISOString().split("T")[0] ?? "") : "-";
  }
  if (key === "botBlocked" || key === "isReturner") {
    return row[key as "botBlocked" | "isReturner"] ? "✓" : "✗";
  }
  const record = row as unknown as Record<string, unknown>;
  return String(record[key] ?? "");
}

function printCsv(rows: BetaReportRow[]): void {
  const headers = [
    "tenantId",
    "onboardedAt",
    "channel",
    "daysInProduct",
    "digestsDelivered",
    "activeDays",
    "totalInfluenced",
    "botBlocked",
    "lastActiveAt",
    "isReturner",
  ];
  process.stdout.write(`${headers.join(",")}\n`);

  for (const row of rows) {
    const line = [
      row.tenantId,
      row.onboardedAt.toISOString().split("T")[0],
      row.channel,
      row.daysInProduct,
      row.digestsDelivered,
      row.activeDays,
      row.totalInfluenced,
      row.botBlocked ? "true" : "false",
      row.lastActiveAt ? row.lastActiveAt.toISOString().split("T")[0] : "",
      row.isReturner ? "true" : "false",
    ];
    process.stdout.write(`${line.join(",")}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `Beta report failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
