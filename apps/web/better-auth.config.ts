/**
 * Entry point for the Better Auth CLI.
 *
 *   npx @better-auth/cli@latest generate --config better-auth.config.ts \
 *     --output ../../packages/db/src/schema/auth.ts
 *
 * The CLI needs a built auth instance exported as `auth`, so that it can read
 * the options and work out which tables they imply. It never connects to
 * anything — which is why the credentials below are obvious placeholders, and
 * why this file must not import the real one: `getAuth()` reads configuration
 * and opens a pool, neither of which exists when generating a schema.
 *
 * The options themselves come from `authOptions`, not a second copy. Two copies
 * would drift, and the way that failure surfaces is a missing column noticed
 * during someone's login.
 *
 * The generated schema is authoritative and is committed like any other schema
 * file. It is never edited by hand.
 */

import { createDatabase } from "@mifluent/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { authOptions } from "./src/lib/auth.js";

// postgres-js does not open a socket until a query runs, and the CLI never
// runs one. This is a shape, not a connection.
const placeholderDatabase = createDatabase({
  connectionString: "postgres://schema:generation@localhost:5432/placeholder",
  maxConnections: 1,
});

export const auth = betterAuth({
  ...authOptions,
  baseURL: "http://localhost:3000",
  secret: "placeholder-secret-used-only-for-schema-generation",
  database: drizzleAdapter(placeholderDatabase, { provider: "pg" }),
});
