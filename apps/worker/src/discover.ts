/**
 * Discovery from the command line, for checking it by hand on real sites
 * before any interface exists (TASK-002).
 *
 * Usage:
 *   npm run discover -- https://plausible.io
 *   npm run discover -- --lang ru "Магазин чая в Telegram"
 *
 * JSON to stdout, a readable table to stderr, time and cost on the last line.
 * Nothing is written to the database — the model call's cost is only counted.
 */

import { getConfig } from "@mifluent/core";
import { type DiscoveryResult, discover } from "@mifluent/discovery";
import { createLlmClient } from "@mifluent/llm";
import { logger, USER_AGENT } from "./runtime.js";

function printTable(result: DiscoveryResult): void {
  const { business } = result;
  const lines = [
    "",
    "═══ Business ═══",
    `  ${business.name} — ${business.niche}`,
    `  ${business.description}`,
    `  ${business.monetization} · ${business.customerType} · platforms: ${business.platforms.join(", ") || "—"} · countries: ${business.countries.join(", ") || "—"}`,
    ...describeGroups(
      "Targets",
      result.targets.map((target) => ({
        heading: `[${target.kind}] ${target.name}${target.websiteUrl === null ? "" : ` — ${target.websiteUrl}`}`,
        reason: target.reason,
        surfaces: target.surfaces,
      })),
    ),
    ...describeGroups(
      "Conditions",
      result.conditions.map((condition) => ({
        heading: condition.name,
        reason: condition.reason,
        surfaces: condition.surfaces,
      })),
    ),
  ];

  process.stderr.write(`${lines.join("\n")}\n`);
}

interface Group {
  readonly heading: string;
  readonly reason: string;
  readonly surfaces: DiscoveryResult["targets"][number]["surfaces"];
}

function describeGroups(title: string, groups: readonly Group[]): string[] {
  const lines = ["", `═══ ${title} ═══`];
  if (groups.length === 0) lines.push("  (none)");

  for (const group of groups) {
    lines.push(`  ${group.heading}`, `    ${group.reason}`);
    for (const surface of group.surfaces) {
      const mark = surface.verified ? "✓" : "✗";
      lines.push(
        `    ${mark} ${surface.label.padEnd(16)} ${surface.type.padEnd(5)} ${surface.url}`,
      );
    }
  }
  return lines;
}

function readArguments(argv: readonly string[]): { input: string; language: "en" | "ru" } | null {
  const args = [...argv];
  let language: "en" | "ru" = "en";
  const langIndex = args.indexOf("--lang");
  if (langIndex !== -1) {
    language = args[langIndex + 1] === "ru" ? "ru" : "en";
    args.splice(langIndex, 2);
  }
  const input = args.join(" ").trim();
  return input === "" || input === "--help" ? null : { input, language };
}

async function main(): Promise<void> {
  const parsed = readArguments(process.argv.slice(2));
  if (parsed === null) {
    process.stderr.write('Usage: npm run discover -- [--lang ru] <url | "description">\n');
    process.exit(1);
  }

  const config = getConfig();
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_CHEAP, LLM_MODEL_DEEP } = config;
  if (!config.features.llm || LLM_BASE_URL === undefined || LLM_API_KEY === undefined) {
    process.stderr.write(
      "No model configured: set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_CHEAP, LLM_MODEL_DEEP.\n",
    );
    process.exit(1);
  }

  let costUsd = 0;
  let tokens = 0;
  const llm = createLlmClient({
    baseUrl: LLM_BASE_URL,
    apiKey: LLM_API_KEY,
    cheapModel: LLM_MODEL_CHEAP ?? "",
    deepModel: LLM_MODEL_DEEP ?? "",
    pricePerMillion: {
      cheapIn: config.LLM_PRICE_CHEAP_IN,
      cheapOut: config.LLM_PRICE_CHEAP_OUT,
      deepIn: config.LLM_PRICE_DEEP_IN,
      deepOut: config.LLM_PRICE_DEEP_OUT,
    },
    onUsage: async (record) => {
      costUsd += record.costUsd;
      tokens += record.inputTokens + record.outputTokens;
    },
  });

  const startedAt = Date.now();
  const result = await discover({ ...parsed, llm, userAgent: USER_AGENT, logger });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  printTable(result);
  process.stderr.write(
    `\nTime: ${((Date.now() - startedAt) / 1000).toFixed(1)} s · tokens: ${tokens} · cost: $${costUsd.toFixed(4)}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Discovery failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
