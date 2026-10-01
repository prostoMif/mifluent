/**
 * A real, empty Postgres for tests that have to check what the database does —
 * tenant isolation, foreign keys, idempotent writes — rather than what a mock
 * says it does.
 *
 * PGlite is Postgres compiled to WebAssembly: no Docker, no server, a fresh
 * database per call. The migrations are applied exactly as `db:migrate` would
 * apply them, so a test also proves the migrations themselves run.
 *
 * Test-only: imported from `*.test.ts` files and nowhere else.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "./client.js";
import * as schema from "./schema/index.js";

interface JournalEntry {
  readonly tag: string;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export interface TestDatabase {
  readonly db: Database;
  readonly close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite({ extensions: { vector } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector");

  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  for (const entry of journal.entries) {
    const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await client.exec(statement);
    }
  }

  // The same query builder over a different driver. Every function in the
  // codebase takes the postgres-js `Database`; the pglite one has the same
  // query surface, which is all a test exercises.
  const db = drizzle(client, { schema }) as unknown as Database;
  return { db, close: () => client.close() };
}
