/**
 * Apply pending migrations, then exit.
 *
 * Runs as its own command before the application starts — not from inside the
 * app on boot. Two processes starting at once would otherwise race to migrate
 * the same database, and the loser fails in a way that looks like a bug in
 * whatever it tried to do next.
 */

import { createLogger } from "@mifluent/core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { assertDatabaseReady, createConnection } from "./client.js";

const logger = createLogger({ base: { role: "migrate" } });

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];

  if (connectionString === undefined || connectionString === "") {
    logger.error("migrate.failed", { reason: "DATABASE_URL is not set" });
    process.exit(1);
  }

  // One connection: this is a single short-lived task, and taking a pool would
  // hold slots the application needs the moment it starts.
  const sql = createConnection({ connectionString, maxConnections: 1 });

  try {
    await assertDatabaseReady(sql);
    logger.info("migrate.started");

    await migrate(drizzle(sql), { migrationsFolder: "./migrations" });

    logger.info("migrate.finished");
  } catch (error) {
    logger.error("migrate.failed", { cause: error });
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
