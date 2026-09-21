/**
 * Cost recording.
 *
 * Writes a row to `operation_costs` with the token usage and computed USD cost.
 * The LLM adapter does not know about the database — it only fires the hook.
 */

import type { Logger } from "@mifluent/core";
import { uuidv7 } from "@mifluent/core";
import type { Database } from "@mifluent/db";
import * as schema from "@mifluent/db/schema";

export interface CostRecordInput {
  readonly tenantId: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly purpose: string;
  readonly pricePerMillionIn?: number;
  readonly pricePerMillionOut?: number;
  readonly durationMs?: number;
  readonly context?: Record<string, unknown>;
}

export interface CostRecordResult {
  readonly id: string;
  readonly costUsd: number;
}

/**
 * Record a model usage cost.
 *
 * Computes USD cost from token counts and per-million prices. If prices are
 * not provided, costUsd is 0.
 */
export async function recordCost(
  database: Database,
  input: CostRecordInput,
  logger?: Logger,
): Promise<CostRecordResult> {
  const {
    tenantId,
    model,
    inputTokens,
    outputTokens,
    purpose,
    pricePerMillionIn = 0,
    pricePerMillionOut = 0,
    durationMs,
    context = {},
  } = input;

  const costUsd = (inputTokens * pricePerMillionIn + outputTokens * pricePerMillionOut) / 1_000_000;
  const id = uuidv7();

  await database.insert(schema.operationCosts).values({
    id,
    tenantId,
    step: "extract",
    model,
    provider: "openai_compatible",
    inputTokens,
    outputTokens,
    costUsd: costUsd.toFixed(6),
    durationMs,
    context: { purpose, ...context },
  });

  if (logger) {
    logger.info("cost.recorded", {
      tenantId,
      model,
      inputTokens,
      outputTokens,
      costUsd,
      purpose,
    });
  }

  return { id, costUsd };
}
