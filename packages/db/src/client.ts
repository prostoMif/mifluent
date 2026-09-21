/**
 * The database connection.
 *
 * Deliberately exported as `unsafeDb`. Every query written against it is
 * unscoped, and the name is there so that reaching for it stands out in a diff.
 * Ordinary application code should go through `tenantDb()` in `tenant.ts`.
 *
 * Connection limits matter more here than they look. The worker runs as a
 * separate process from the web app, and if the worker opens as many
 * connections as it likes, it starves the process serving people reading their
 * digest on a phone. Both get an explicit ceiling.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export interface DatabaseOptions {
  readonly connectionString: string;
  /** Ceiling on pooled connections for this process. */
  readonly maxConnections?: number;
  /** Seconds a connection may sit idle before being closed. */
  readonly idleTimeout?: number;
  /** Seconds to wait for a connection before failing. */
  readonly connectTimeout?: number;
  /** Log every statement. Development only — statements contain user data. */
  readonly debug?: boolean;
}

export function createConnection(options: DatabaseOptions) {
  return postgres(options.connectionString, {
    max: options.maxConnections ?? 10,
    idle_timeout: options.idleTimeout ?? 30,
    connect_timeout: options.connectTimeout ?? 10,
    // Everything is UTC. Setting it on the connection removes any dependence on
    // the timezone of the machine the container happens to run on.
    connection: { TimeZone: "UTC" },
    onnotice: () => undefined,
  });
}

export function createDatabase(options: DatabaseOptions) {
  const sql = createConnection(options);
  return drizzle(sql, { schema, logger: options.debug ?? false });
}

export type Database = ReturnType<typeof createDatabase>;
export type Connection = ReturnType<typeof createConnection>;

/** The handle a callback receives inside `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Anything a query can be run against.
 *
 * Functions that read or write should take this rather than `Database`. The
 * same function then works standalone and as one step inside a transaction,
 * which is what stops a multi-step operation from being written twice — once
 * safely and once not.
 */
export type Queryable = Database | Transaction;

/**
 * Minimum supported PostgreSQL major version.
 *
 * Checked at startup rather than discovered through a confusing error on the
 * first query. One declared version means one reproducible problem in an issue,
 * instead of a support matrix maintained by nobody.
 */
export const MINIMUM_POSTGRES_MAJOR = 16;

export async function assertDatabaseReady(sql: Connection): Promise<void> {
  const [versionRow] = await sql<{ server_version: string }[]>`SHOW server_version`;
  const major = Number.parseInt(versionRow?.server_version ?? "0", 10);

  if (Number.isNaN(major) || major < MINIMUM_POSTGRES_MAJOR) {
    throw new Error(
      `PostgreSQL ${MINIMUM_POSTGRES_MAJOR} or later is required, found ${
        versionRow?.server_version ?? "an unreadable version"
      }.`,
    );
  }

  const [extensionRow] = await sql<{ installed: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) AS installed
  `;

  if (extensionRow?.installed !== true) {
    throw new Error(
      "The pgvector extension is not installed. Use the pgvector/pgvector image, " +
        "or run CREATE EXTENSION vector as a superuser.",
    );
  }
}
