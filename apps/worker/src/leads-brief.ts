/**
 * From a 2GIS export to ready-to-send messages.
 *
 *   npm run leads:brief -- export.csv [--limit 40] [--competitors 5] [--link https://t.me/bot]
 *
 * For every business in the export that has a site, its competitors are the
 * other businesses of the same export (same city and category). Their sites
 * are read for current offers, prices and news; a model picks up to three,
 * each quote checked word for word against the page. Writes
 * `leads-out/index.html` (one-click WhatsApp / Telegram / e-mail) and
 * `leads-out/summary.csv`. Nothing is sent automatically.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "@mifluent/core";
import { createLlmClient } from "@mifluent/llm";
import { competitorPages } from "./leads/competitor-pages.js";
import { pickFindings, renderMessage, renderOfferMessage } from "./leads/outreach.js";
import { renderSendPage, type SendCard } from "./leads/send-page.js";
import { competitorsFor, readTwoGisCsv } from "./leads/two-gis-csv.js";
import { logger } from "./runtime.js";

const OUT_DIR = "leads-out";

interface Options {
  readonly file: string;
  readonly limit: number;
  readonly competitors: number;
  readonly link: string | null;
}

function parseOptions(argv: readonly string[]): Options | null {
  let file: string | null = null;
  let limit = 40;
  let competitors = 5;
  let link: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const next = argv[index + 1];
    if (arg === "--limit" && next !== undefined) {
      limit = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--competitors" && next !== undefined) {
      competitors = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--link" && next !== undefined) {
      link = next;
      index += 1;
    } else if (!arg.startsWith("--")) file = arg;
  }
  if (file === null || !Number.isFinite(limit) || !Number.isFinite(competitors)) return null;
  return { file, limit, competitors, link };
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options === null) {
    process.stderr.write(
      "Usage: npm run leads:brief -- export.csv [--limit 40] [--competitors 5] [--link https://t.me/bot]\n",
    );
    process.exit(1);
  }
  const config = getConfig();
  if (config.LLM_BASE_URL === undefined || config.LLM_API_KEY === undefined) {
    process.stderr.write("No model configured: set LLM_BASE_URL and LLM_API_KEY.\n");
    process.exit(1);
  }
  const link =
    options.link ??
    (config.TELEGRAM_BOT_USERNAME === undefined
      ? config.APP_URL
      : `https://t.me/${config.TELEGRAM_BOT_USERNAME}`);

  let costUsd = 0;
  const llm = createLlmClient({
    baseUrl: config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY,
    cheapModel: config.LLM_MODEL_CHEAP ?? "",
    deepModel: config.LLM_MODEL_DEEP ?? "",
    pricePerMillion: {
      cheapIn: config.LLM_PRICE_CHEAP_IN,
      cheapOut: config.LLM_PRICE_CHEAP_OUT,
      deepIn: config.LLM_PRICE_DEEP_IN,
      deepOut: config.LLM_PRICE_DEEP_OUT,
    },
    onUsage: async (record) => {
      costUsd += record.costUsd;
    },
  });

  const all = readTwoGisCsv(readFileSync(options.file, "utf8"));
  const leads = all
    .filter((lead) => lead.whatsapp !== null || lead.phone !== null || lead.email !== null)
    .slice(0, options.limit);
  mkdirSync(OUT_DIR, { recursive: true });

  const cards: SendCard[] = [];
  const rows = ["name,phone,whatsapp,email,telegram,findings,message"];
  for (const lead of leads) {
    process.stderr.write(`→ ${lead.name}… `);
    const competitors = competitorsFor(lead, all, options.competitors);
    try {
      const pages = (
        await Promise.all(
          competitors.map((competitor) =>
            competitorPages(competitor.name, competitor.website ?? ""),
          ),
        )
      ).flat();
      const findings = await pickFindings(llm, lead, pages);
      const message = renderMessage(lead, competitors, findings);
      cards.push({ lead, message, findings: findings.length });
      rows.push(
        [
          lead.name,
          lead.phone ?? "",
          lead.whatsapp ?? "",
          lead.email ?? "",
          lead.telegram ?? "",
          String(findings.length),
          message,
        ]
          .map(csvCell)
          .join(","),
      );
      process.stderr.write(`${pages.length} pages, ${findings.length} findings\n`);
    } catch (error) {
      logger.warn("leads.brief_failed", { lead: lead.name, cause: error });
      process.stderr.write(`failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    // Written after every lead, so a stopped run keeps what it already made.
    cards.sort((a, b) => b.findings - a.findings);
    writeFileSync(join(OUT_DIR, "index.html"), renderSendPage(cards));
    writeFileSync(join(OUT_DIR, "summary.csv"), `${rows.join("\n")}\n`);
  }
  writeFileSync(join(OUT_DIR, "reply-to-yes.txt"), `${renderOfferMessage(link)}\n`);

  process.stderr.write(
    `\nDone: ${cards.length} messages → ${OUT_DIR}/index.html · model cost $${costUsd.toFixed(3)}\n` +
      `The offer with the price and link, for those who answer yes: ${OUT_DIR}/reply-to-yes.txt\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `leads:brief failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
