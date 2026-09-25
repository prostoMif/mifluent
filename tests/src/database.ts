/**
 * The harness for tests that need a real PostgreSQL.
 *
 * `docs/code-style.md` names three areas where a test is not optional: tenant
 * isolation, quote verification and job idempotency. Two of those are
 * statements about what a *query* does, and a fake database cannot make them —
 * a scoped query and an unscoped one look identical until a server runs them.
 * That gap is not academic: the cross-tenant write in `createSource` sat in the
 * codebase with a green suite because nothing here ever executed SQL.
 *
 * These tests are skipped unless `TEST_DATABASE_URL` names a database they may
 * write to. Deliberately not `DATABASE_URL`: a suite that picks up whatever
 * connection string happens to be exported is one `npm test` away from writing
 * to something that matters.
 *
 * Each test owns its tenants and deletes them at the end; every table cascades
 * from `tenants`, so that is the whole cleanup. No `TRUNCATE`, and nothing
 * touches rows the test did not create.
 */

import { randomUUID } from "node:crypto";
import { createDatabase, type Database, schema } from "@mifluent/db";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const CONNECTION_STRING = process.env["TEST_DATABASE_URL"];

/** Whether these tests can run at all. Used with `describe.skipIf`. */
export const hasTestDatabase = CONNECTION_STRING !== undefined && CONNECTION_STRING !== "";

/**
 * Configuration the code under test reads at first use.
 *
 * `findTenantPlan` and the cost cap both call `getConfig()`, which validates
 * the whole environment and fails fast if it cannot. These are the required
 * fields, filled with values that are obviously not credentials — nothing here
 * reaches a network.
 */
if (hasTestDatabase) {
  process.env["DATABASE_URL"] ??= CONNECTION_STRING;
  process.env["BETTER_AUTH_SECRET"] ??= "test-only-not-a-secret-".padEnd(48, "x");
  process.env["ENCRYPTION_KEY"] ??= "test-only-not-a-key-".padEnd(48, "x");
  process.env["BETTER_AUTH_URL"] ??= "http://localhost:3000";
  process.env["APP_URL"] ??= "http://localhost:3000";
  process.env["NODE_ENV"] ??= "test";
}

let database: Database | undefined;
let migrated: Promise<void> | undefined;

/** The connection, with every migration applied. */
export async function getTestDatabase(): Promise<Database> {
  if (CONNECTION_STRING === undefined) {
    throw new Error("TEST_DATABASE_URL is not set; guard with `describe.skipIf`.");
  }

  migrated ??= applyMigrations(CONNECTION_STRING);
  await migrated;

  database ??= createDatabase({ connectionString: CONNECTION_STRING, maxConnections: 4 });
  return database;
}

/**
 * Any number, as long as it is the same one in every worker.
 *
 * Vitest runs each test file in its own process, so on a database that has
 * never been migrated all of them reach for the migrator at once and race to
 * `CREATE TYPE`. An advisory lock is held by the session rather than by a
 * transaction, which is what makes it work across processes: the first worker
 * migrates, the rest wait and then find nothing to do.
 */
const MIGRATION_LOCK = 4_919_284_015;

async function applyMigrations(connectionString: string): Promise<void> {
  // Postgres announces "extension already exists, skipping" on every run;
  // the migrator is meant to be idempotent, so that is not news.
  const connection = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    await connection`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
    try {
      await connection`CREATE EXTENSION IF NOT EXISTS vector`;
      await migrate(drizzle(connection), { migrationsFolder: "packages/db/migrations" });
    } finally {
      await connection`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;
    }
  } finally {
    await connection.end({ timeout: 5 });
  }
}

export interface TestTenant {
  readonly tenantId: string;
  readonly profileId: string;
  readonly versionId: string;
}

/**
 * A tenant with one profile and one profile version — the least a digest or a
 * source needs to exist. Names are unique per call, so two tests running
 * against one database never collide.
 */
export async function createTestTenant(
  db: Database,
  options: { readonly language?: "en" | "ru" } = {},
): Promise<TestTenant> {
  const tenantId = randomUUID();
  const profileId = randomUUID();
  const versionId = randomUUID();

  await db.insert(schema.tenants).values({ id: tenantId, name: `test-${tenantId}`, plan: "free" });
  await db.insert(schema.watchProfiles).values({
    id: profileId,
    tenantId,
    name: `profile-${profileId}`,
    relevanceThreshold: 0.5,
    currentVersionId: versionId,
    ...(options.language === undefined ? {} : { facts: { language: options.language } }),
  });
  await db.insert(schema.watchProfileVersions).values({
    id: versionId,
    tenantId,
    profileId,
    version: 1,
    snapshot: {},
  });
  await db
    .update(schema.watchProfiles)
    .set({ currentVersionId: versionId })
    .where(eq(schema.watchProfiles.id, profileId));

  return { tenantId, profileId, versionId };
}

/** Everything cascades from the tenant, so this is the whole cleanup. */
export async function deleteTestTenants(db: Database, tenantIds: readonly string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  await db.delete(schema.tenants).where(inArray(schema.tenants.id, [...tenantIds]));
}
