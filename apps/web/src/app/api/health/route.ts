/**
 * Health check.
 *
 * The one endpoint that deliberately does not use `route()`: it must answer
 * even when configuration is broken, and it answers with a status code that a
 * watchdog can act on rather than a 200 carrying bad news.
 *
 * It reports *what* is wrong, never *why* in detail — "the database is
 * unreachable" is useful to an operator, the connection string in the error
 * message is useful to an attacker. Details go to the log.
 */

import { getConfig, isAppError } from "@mifluent/core";
import { getConnection } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "failed";

interface HealthReport {
  readonly status: "healthy" | "unhealthy";
  readonly checks: {
    readonly configuration: CheckStatus;
    readonly database: CheckStatus;
  };
}

const DATABASE_TIMEOUT_MS = 3_000;

async function checkDatabase(): Promise<CheckStatus> {
  try {
    const sql = getConnection();

    // A hung database must not hold the health endpoint open — a watchdog that
    // never gets an answer cannot tell "slow" from "dead".
    await Promise.race([
      sql`SELECT 1`,
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("timed out")), DATABASE_TIMEOUT_MS);
      }),
    ]);

    return "ok";
  } catch (error) {
    logger.error("health.database_failed", { cause: error });
    return "failed";
  }
}

function checkConfiguration(): CheckStatus {
  try {
    getConfig();
    return "ok";
  } catch (error) {
    logger.error("health.configuration_failed", {
      // The message lists which variables are wrong. It is safe here because it
      // names variables without printing their values.
      reason: isAppError(error) ? error.message : "unknown",
    });
    return "failed";
  }
}

export async function GET(): Promise<Response> {
  const configuration = checkConfiguration();

  // No point dialling the database when the connection string never parsed.
  const database = configuration === "ok" ? await checkDatabase() : "failed";

  const healthy = configuration === "ok" && database === "ok";

  const report: HealthReport = {
    status: healthy ? "healthy" : "unhealthy",
    checks: { configuration, database },
  };

  return new Response(JSON.stringify(report), {
    status: healthy ? 200 : 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
