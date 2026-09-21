import { getConfig } from "@mifluent/core";
import { type Connection, createConnection, createDatabase, type Database } from "@mifluent/db";

/**
 * One connection pool for this process.
 *
 * Created on first use rather than at import time, so that a module importing
 * this file does not open a socket just by being loaded — which in Next.js
 * happens during the build, on a machine with no database.
 *
 * The pool is deliberately small. The worker runs as a separate process and
 * competes for the same server; leaving both unbounded means whichever starts
 * first starves the other, and the one that loses is usually the one serving
 * somebody's morning digest.
 */
let connection: Connection | undefined;
let database: Database | undefined;

const WEB_MAX_CONNECTIONS = 10;

export function getConnection(): Connection {
  connection ??= createConnection({
    connectionString: getConfig().DATABASE_URL,
    maxConnections: WEB_MAX_CONNECTIONS,
  });
  return connection;
}

export function getDatabase(): Database {
  database ??= createDatabase({
    connectionString: getConfig().DATABASE_URL,
    maxConnections: WEB_MAX_CONNECTIONS,
  });
  return database;
}
