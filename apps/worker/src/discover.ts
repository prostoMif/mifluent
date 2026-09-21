/**
 * Discovery CLI.
 *
 * Usage: npm run discover -- <url|"description text">
 *
 * Outputs JSON to stdout, table to stderr.
 */

import { getConfig } from "@mifluent/core";
import { type DiscoveryResult, discover } from "@mifluent/discovery";
import { createLlmClient } from "@mifluent/llm";

function printTable(result: DiscoveryResult): void {
  const lines: string[] = [];

  lines.push("");
  lines.push("═══ Business ═══");
  lines.push(`  Name:        ${result.business.name}`);
  lines.push(`  Niche:       ${result.business.niche}`);
  lines.push(`  Monetization: ${result.business.monetization}`);
  lines.push(`  Platforms:   ${result.business.platforms.join(", ") || "—"}`);
  lines.push(`  Countries:   ${result.business.countries.join(", ") || "—"}`);
  lines.push(`  Customer:    ${result.business.customerType}`);
  lines.push(`  Language:    ${result.business.language}`);
  lines.push(`  Description: ${result.business.description}`);

  lines.push("");
  lines.push("═══ Targets ═══");
  if (result.targets.length === 0) {
    lines.push("  (none)");
  } else {
    for (const target of result.targets) {
      const verified = target.surfaces.filter((s) => s.verified).length;
      const total = target.surfaces.length;
      lines.push(`  [${target.kind}] ${target.name}`);
      lines.push(`    URL:    ${target.websiteUrl || "—"}`);
      lines.push(`    Reason: ${target.reason}`);
      lines.push(
        `    Surfaces: ${verified}✓ / ${total} (${target.surfaces.map((s) => `${s.type}:${s.verified ? "✓" : "✗"}`).join(", ")})`,
      );
    }
  }

  lines.push("");
  lines.push("═══ Conditions ═══");
  if (result.conditions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const condition of result.conditions) {
      const verified = condition.surfaces.filter((s) => s.verified).length;
      const total = condition.surfaces.length;
      lines.push(`  ${condition.name}`);
      lines.push(`    Reason: ${condition.reason}`);
      lines.push(
        `    Surfaces: ${verified}✓ / ${total} (${condition.surfaces.map((s) => `${s.type}:${s.verified ? "✓" : "✗"}`).join(", ")})`,
      );
    }
  }

  lines.push("");
  process.stderr.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stderr.write(`
Discovery CLI

Usage:
  npm run discover -- <url|"description text">

Examples:
  npm run discover -- https://plausible.io
  npm run discover -- "SaaS for email marketing with AI content generation"

Output:
  JSON to stdout
  Human-readable table to stderr
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const input = args.join(" ");

  // Load config
  const config = getConfig();

  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_CHEAP, LLM_MODEL_DEEP } = config;

  if (
    LLM_BASE_URL === undefined ||
    LLM_API_KEY === undefined ||
    LLM_MODEL_CHEAP === undefined ||
    LLM_MODEL_DEEP === undefined
  ) {
    process.stderr.write(
      "Error: LLM not configured. Set LLM_API_KEY, LLM_BASE_URL, LLM_MODEL_CHEAP, LLM_MODEL_DEEP\n",
    );
    process.exit(1);
  }

  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const llm = createLlmClient({
    baseUrl: LLM_BASE_URL,
    apiKey: LLM_API_KEY,
    cheapModel: LLM_MODEL_CHEAP,
    deepModel: LLM_MODEL_DEEP,
    pricePerMillion: {
      cheapIn: config.LLM_PRICE_CHEAP_IN ?? 0,
      cheapOut: config.LLM_PRICE_CHEAP_OUT ?? 0,
      deepIn: config.LLM_PRICE_DEEP_IN ?? 0,
      deepOut: config.LLM_PRICE_DEEP_OUT ?? 0,
    },
    // The usage hook is the supported way to observe spend; `complete` is read-only.
    onUsage: async (record) => {
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;
    },
  });

  try {
    const result = await discover({
      input,
      llm,
      language: "en",
    });

    const elapsedMs = Date.now() - startTime;

    // Output JSON to stdout
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    // Output table to stderr
    printTable(result);

    // Cost summary
    const cheapIn = config.LLM_PRICE_CHEAP_IN ?? 0;
    const cheapOut = config.LLM_PRICE_CHEAP_OUT ?? 0;
    const costUsd = (totalInputTokens * cheapIn + totalOutputTokens * cheapOut) / 1_000_000;

    process.stderr.write(
      `\nTime: ${elapsedMs}ms | Tokens: ${totalInputTokens} in / ${totalOutputTokens} out | Cost: $${costUsd.toFixed(6)}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
