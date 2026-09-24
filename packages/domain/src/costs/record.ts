/**
 * Cost recording.
 *
 * Writes one row to `operation_costs` per model call. The LLM adapter knows
 * nothing about the database — it fires a usage hook, and the hook calls this.
 *
 * The step column is derived from the call's purpose rather than passed in, so
 * a new caller cannot file its spend under the wrong stage of the cascade.
 */

import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema } from "@mifluent/db";

export type CostPurpose = "discovery" | "selection" | "extraction";

type PipelineStep = (typeof schema.pipelineStepEnum.enumValues)[number];

const STEP_BY_PURPOSE: Readonly<Record<CostPurpose, PipelineStep>> = {
  discovery: "discover",
  selection: "classify",
  extraction: "extract",
};

export interface CostRecordInput {
  readonly tenantId: string;
  readonly purpose: CostPurpose;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly durationMs?: number | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
}

export async function recordCost(db: Queryable, input: CostRecordInput): Promise<void> {
  await db.insert(schema.operationCosts).values({
    id: uuidv7(),
    tenantId: input.tenantId,
    step: STEP_BY_PURPOSE[input.purpose],
    model: input.model,
    provider: "openai_compatible",
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUsd: input.costUsd.toFixed(6),
    durationMs: input.durationMs ?? null,
    context: { ...input.context, purpose: input.purpose },
  });
}

export function isCostPurpose(value: string): value is CostPurpose {
  return value in STEP_BY_PURPOSE;
}
