import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated, never pushed.
 *
 * `drizzle-kit push` diffs against whatever the database currently looks like
 * and applies the difference without leaving a file behind. That is fine on one
 * laptop and useless everywhere else: on someone else's self-hosted instance
 * there is no shared history to diff against, and the same command produces a
 * different result. Generated SQL files are committed and applied in order, so
 * every instance ends up in the same state.
 *
 * There are no down migrations. Rolling back means writing a new migration
 * forward — a correct `down` for a dropped column does not bring the data back,
 * it only creates the impression that it might. Take a dump first instead.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "",
  },
  strict: true,
  verbose: true,
});
