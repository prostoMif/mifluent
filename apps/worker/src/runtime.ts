/**
 * The pieces of the outside world this process talks to.
 *
 * Its own copy rather than the web application's: the collector runs as a
 * separate process, in its own container, and the whole point of that split is
 * that neither can take the other down. Sharing a module would quietly make
 * them one thing again.
 */

import { AppError, createLogger, getConfig, type Logger } from "@mifluent/core";
import { createDatabase, type Database, type Queryable } from "@mifluent/db";
import { createTelegramApi, type TelegramApi } from "@mifluent/delivery";
import { isCostPurpose, readCostCap, recordCost } from "@mifluent/domain";
import { type EmbeddingProvider, getEmbeddingProvider } from "@mifluent/embeddings";
import { createLlmClient, type LlmClient, type UsageRecord } from "@mifluent/llm";
import type { CostGuard } from "@mifluent/pipeline";
import packageJson from "../package.json" with { type: "json" };

/**
 * Fewer connections than the web application gets.
 *
 * Both processes share one PostgreSQL server, and an unbounded collector
 * starves the one serving somebody their morning digest. Between the two, the
 * digest wins.
 */
const WORKER_MAX_CONNECTIONS = 5;

let database: Database | undefined;

export function getDatabase(): Database {
  database ??= createDatabase({
    connectionString: getConfig().DATABASE_URL,
    maxConnections: WORKER_MAX_CONNECTIONS,
  });

  return database;
}

export const logger: Logger = createLogger({
  level: getConfig().LOG_LEVEL,
  base: { role: "worker" },
  pretty: !getConfig().isProduction,
});

/**
 * Sent with every outbound request, so whoever is being polled can see who is
 * doing it and find a page explaining why. An anonymous poller is the kind that
 * gets blocked.
 */
export const USER_AGENT = `Mifluent/${packageJson.version} (+https://github.com/prostoMif/mifluent)`;

/**
 * The model client, with every call's cost written to the database the caller
 * is working in — the real one, or the dry run's transaction that is rolled
 * back. Undefined when no model is configured: collection and the free
 * filter still run, extraction does not.
 */
export function createPipelineLlm(
  db: Queryable,
  onUsage?: (record: UsageRecord) => void,
): LlmClient | undefined {
  const config = getConfig();
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_CHEAP, LLM_MODEL_DEEP } = config;

  if (!config.features.llm || LLM_BASE_URL === undefined || LLM_API_KEY === undefined) {
    return undefined;
  }

  return createLlmClient({
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
    logger,
    onUsage: async (record) => {
      onUsage?.(record);
      await recordUsage(db, record);
    },
  });
}

async function recordUsage(db: Queryable, record: UsageRecord): Promise<void> {
  if (record.tenantId === undefined || !isCostPurpose(record.purpose)) {
    // Every pipeline call names a tenant and one of the known purposes; one
    // that does not is a programming error, and dropping its cost silently
    // would make the spend report lie.
    throw new AppError("internal_error", "Something went wrong on our side.", {
      reason: "model call without tenant or known purpose",
      purpose: record.purpose,
    });
  }

  await recordCost(db, {
    tenantId: record.tenantId,
    purpose: record.purpose,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    costUsd: record.costUsd,
    durationMs: record.latencyMs,
    context: record.tags,
  });
}

/** "Has today's spend crossed the cap?" — asked before every model call. */
export function createCostGuard(db: Queryable): CostGuard {
  const cap = getConfig().DAILY_COST_CAP_USD;
  return async () => (await readCostCap(db, cap)).isReached;
}

export function getEmbedder(): EmbeddingProvider {
  return getEmbeddingProvider({ modelsDir: getConfig().MODELS_DIR, logger });
}

export function getTelegramApi(): TelegramApi | undefined {
  const token = getConfig().TELEGRAM_BOT_TOKEN;
  return token === undefined ? undefined : createTelegramApi({ token });
}

/** Defaults a profile's delivery settings fall back to. */
export function deliveryDefaults(): { timezone: string; hour: number } {
  const config = getConfig();
  return {
    timezone: config.DEFAULT_TIMEZONE,
    hour: Number(config.DIGEST_DEFAULT_TIME.slice(0, 2)),
  };
}
