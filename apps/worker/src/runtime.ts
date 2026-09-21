/**
 * The pieces of the outside world this process talks to.
 *
 * Its own copy rather than the web application's: the collector runs as a
 * separate process, in its own container, and the whole point of that split is
 * that neither can take the other down. Sharing a module would quietly make
 * them one thing again.
 */

import { createLogger, getConfig, type Logger } from "@mifluent/core";
import { createDatabase, type Database } from "@mifluent/db";
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
export const USER_AGENT = `Mifluent/${packageJson.version} (+https://github.com/OWNER/mifluent)`;
