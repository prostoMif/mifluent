# Contributing to Mifluent

Thanks for taking the time. This document covers the contributor licence
agreement, the conventions this codebase holds to, and what a reviewable pull
request looks like.

If anything here is unclear or looks wrong, open an issue — the conventions are
meant to be argued with, just not silently ignored.

---

## Contributor Licence Agreement

**Every pull request requires a signed CLA.** This is enforced on the first
contribution and there are no exceptions, including for one-line fixes.

Signing is automated: open a pull request and a bot will comment with a link.
Click through once, and it remembers you for every future contribution.

### What you are agreeing to

By contributing you confirm that:

1. You wrote the contribution yourself, or you have the right to submit it under
   the terms below.
2. You grant the project maintainer a perpetual, worldwide, non-exclusive,
   royalty-free licence to use, reproduce, modify, sublicense and distribute
   your contribution, including under licences other than AGPL-3.0.
3. You keep the copyright to your own work. This is a licence grant, not an
   assignment — you can still use your contribution anywhere else you like.
4. Your contribution is provided as-is, without warranty of any kind.

### Why a CLA exists here

The project is AGPL-3.0 and a commercial hosted version runs from the same
codebase. Without the right to relicense, that combination is not legally
possible, and collecting the agreement retroactively from every past contributor
never works. So it is collected from the first pull request onward.

---

## Before you start

For anything beyond a typo or an obvious bug fix, **open an issue first.** A
large pull request that does not fit the architecture is painful to reject and
worse to merge, and that outcome is bad for everyone's afternoon.

Good first contributions: broken source connectors, failing edge cases in
parsing, documentation that misled you, missing test coverage.

---

## Development setup

Requires Node.js 22 or later, and PostgreSQL 16+ with the pgvector extension.

```bash
git clone https://github.com/prostoMif/mifluent.git
cd mifluent
npm install
cp .env.example .env    # fill in the required variables
```

### The database

Two ways, both fine.

**Docker** — one command, and it is the same image the release ships with:

```bash
npm run db:up          # PostgreSQL 17 with pgvector, on localhost:5432
npm run db:migrate
```

**A hosted Postgres** — if you would rather not install Docker. Any provider
with pgvector works (Neon and Supabase both have it on their free tiers). Create
a database, put its connection string in `DATABASE_URL`, and run:

```bash
npm run db:migrate
```

Installing PostgreSQL natively also works, but you have to build and install
pgvector yourself, which on Windows means a C toolchain. The two options above
are less of an afternoon.

### The auth schema

The tables Better Auth needs are generated from its configuration, never
written by hand — a column the library expects and does not find fails at
runtime, inside the login flow, which is the worst place to find a typo.

After changing anything in `apps/web/src/lib/auth.ts`:

```bash
cd apps/web
npx @better-auth/cli@latest generate \
  --config better-auth.config.ts \
  --output ../../packages/db/src/schema/auth.ts
cd ../..
npm run db:generate      # turn the schema change into a migration
```

Migrations under `packages/db/migrations` are generated output. They are
committed, but Biome does not lint or format them.

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | Build the packages, then start the app on port 3000 |
| `npm run check` | Lint, format check, types and tests — what CI runs |
| `npm run check:fix` | Apply every safe lint and format fix |
| `npm test` | Tests only |
| `TEST_DATABASE_URL=… npm test` | Tests, including the ones that need a database |
| `npm run typecheck` | Types only |
| `npm run db:up` | Start PostgreSQL in Docker |
| `npm run db:generate` | Generate a migration from a schema change |
| `npm run db:migrate` | Apply pending migrations |

The packages under `packages/` are consumed from their built output, so
`npm run dev` builds them first. After editing a package, restart the dev
server — the Next.js watcher does not rebuild them for you.

### Tests that need a database

Most tests are pure and run anywhere. The ones under `tests/` are not: tenant
isolation and job idempotency are statements about what a *query* does, and a
scoped query and an unscoped one are the same TypeScript. Those run only when
`TEST_DATABASE_URL` points at a database they may write to:

```bash
npm run db:up            # the dev PostgreSQL, on 127.0.0.1:5432
createdb -h localhost -U mifluent mifluent_test
TEST_DATABASE_URL=postgres://mifluent:mifluent@localhost:5432/mifluent_test npm test
```

They apply the migrations themselves, build their own tenants, and delete
those tenants afterwards — every table cascades from `tenants`, so nothing
else is touched. Without the variable they are skipped and `npm run check`
is green, which is what CI sees today. Deliberately not `DATABASE_URL`: a
suite that picks up whatever connection string happens to be exported is one
`npm test` away from writing somewhere that matters.

---

## Architecture rules that are not up for casual change

These are load-bearing. A pull request that breaks one gets rejected on
principle, not on taste — so if you think one is wrong, argue it in an issue
before writing the code.

- **The pipeline is a cascade:** fetch → deduplicate → cheap classifier →
  expensive extraction → verification → matching. The expensive model runs on
  the 10–15% of material that clears the cheap filter. Do not move an expensive
  model earlier in the cascade.
- **Relevance is a trained classifier** over embeddings, not a prompt that asks a
  model to rate something out of 10. Do not replace the classifier with an LLM
  call.
- **Every extracted claim carries a verbatim quote and an offset** into the
  source, and the quote is verified programmatically for an exact match. No
  match, no claim. Do not weaken this to fuzzy matching.
- **No agents in the pipeline.** The single exception is discovering sources
  during onboarding.
- **Source text is untrusted data, never instructions.** System prompt and source
  material are separated structurally, and the material is always marked as
  untrusted. Never interpolate source text into the system portion of a prompt.
- **Model output is validated against a Zod schema.** If it does not parse, that
  is an error — not an invitation to guess what was meant.

## Multi-tenancy

`tenant_id` exists on every table and in every query. This is not optional and
it is the highest-severity bug class in the project.

- The data access layer must make it impossible to run a query without a
  `tenant_id`. If you find yourself writing raw SQL that bypasses it, stop and
  say so in the pull request.
- Never return an object by ID alone without checking it belongs to the caller's
  tenant.

---

## Naming conventions

Fixed before the first line of code. Consistency matters more than any
individual preference here.

| What | Rule | Example |
|---|---|---|
| Tables | `snake_case`, plural | `watch_profiles`, `raw_items` |
| Columns | `snake_case` | `tenant_id`, `created_at` |
| Foreign keys | `<singular_entity>_id` | `source_id` |
| Timestamps | `_at` suffix, type `timestamptz` | `published_at`, `deleted_at` |
| Booleans | `is_` / `has_` prefix | `is_active` |
| TypeScript values | `camelCase` (Drizzle maps to snake_case) | `tenantId` |
| Types and classes | `PascalCase` | `WatchProfile` |
| Files | `kebab-case.ts` | `watch-profile.ts` |
| Packages | `@mifluent/<name>` | `@mifluent/ingestion` |
| Endpoints | `/api/<plural-resource>`, kebab-case | `/api/watch-profiles/:id/sources` |
| Log events | `<domain>.<past-tense-action>` | `digest.delivered`, `item.discarded` |
| Queue jobs | `<domain>:<action>` | `source:poll`, `digest:build` |
| Env variables | `SCREAMING_SNAKE_CASE` | `WORKER_CONCURRENCY` |

**No abbreviations** except `id`, `url` and `api`. `usr`, `cfg`, `tmp` and
friends are rejected: they invite a second spelling of the same concept, and
assistants generating code never guess them the same way twice.

Names and comments are written in English, throughout.

---

## Repository layout

```
apps/
  web/                  Next.js app — UI and API routes
  worker/               the collector: schedules, jobs, CLI commands
packages/
  core/                 config, errors, logging, shared utilities
  db/                   Drizzle schema, migrations, tenant-scoped access
  domain/               profiles, sources, tenancy, plans, decisions
  sources/              connectors, feed parsing, safe-fetch
  embeddings/           local embedding model
  pipeline/             selection, extraction, clustering, pruning
  digest/               assembling a digest from events
  delivery/             Telegram: rendering, buttons, binding
  discovery/            onboarding: a site to targets and surfaces
  llm/                  model access, prompts, output validation
tests/                  tests that need a real database
```

The rule: a package never imports from `apps/`. Dependencies point inward.

---

## Code style

- **Strict TypeScript.** `any` is banned. So are untyped returns on exported
  functions. If you genuinely need an escape hatch, use `unknown` and narrow it.
- **Small files, one responsibility each.**
- **No business logic in route handlers.** A handler validates input, calls into
  a package, and shapes the response. That is all.
- **External contracts are described by schemas** — Zod at every boundary where
  data arrives from outside the process.
- Formatting and linting are handled by Biome. Do not argue with the formatter;
  run `npm run format`.

### Errors

One error class, used everywhere:

- It carries a stable machine-readable `code`, a message safe to show a user,
  and a `details` field that goes to the log and never to the client.
- Stack traces, internal paths and SQL never reach the client.
- Errors are handled explicitly. A caught error that is silently swallowed is a
  review failure.

### API responses

Every endpoint returns the same envelope: either a `data` payload or an `error`
object carrying `code` and a user-safe `message`. Clients should never have to
guess which shape came back.

### Logging

- Structured JSON. One event per line.
- `info` — things that happened and were expected: a digest delivered, a source
  polled.
- `warn` — degraded but handled: a source failed and will be retried.
- `error` — something needs a human.
- **Never logged, under any level:** model API keys, passwords, session tokens,
  full email bodies, or anything personal beyond an identifier.

### Secrets

Configuration comes from environment variables only — there is no config file.
Never put a secret in code, and never invent a plausible-looking placeholder
credential. BYOK keys are encrypted at the field level, and after saving are only
ever displayed as their last four characters.

### Outbound requests

Any request to a user-supplied URL:

- resolves the hostname and checks the resulting IP against private ranges,
  loopback and link-local — **re-checked on every redirect**;
- allows the `http` and `https` schemes only;
- has a redirect limit, a timeout, and a response size cap.

Feed and XML parsing runs with external entities and DTDs disabled.

### Mark it for review

Add `// TODO: security review` when touching authentication, authorisation,
cryptography, payments, file handling, anything that fetches a user-supplied URL,
and anything that assembles a prompt.

---

## Commits

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<optional scope>): <description>
```

Types in use: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`. A breaking change gets a `!` after the type and a `BREAKING CHANGE:`
footer explaining what a self-hoster has to do about it.

```
feat(ingestion): add Hacker News connector
fix(digest): drop claims whose quote is missing from the source
refactor(db)!: rename source_state to source_status

BREAKING CHANGE: run `npm run db:migrate` before starting the new image.
```

## Branching and versioning

Trunk-based: work on short-lived branches off `main`, merge back quickly, tag
releases. No long-running development branch.

Semantic versioning. Before 1.0, breaking changes may land in minor releases,
but they will always be spelled out in the changelog.

## Migrations

- Generated with `drizzle-kit generate`, never `drizzle-kit push`. The SQL files
  are committed alongside the schema change.
- **Forward-only. There are no down migrations.** Roll back by writing a new
  migration forward. Take a database dump before migrating — the command is in
  the README.
- Destructive changes take two releases: stop reading the column in one release,
  drop it in the next. Otherwise anyone rolling back to the previous image finds
  a broken database.

Migrations are never edited or applied by an assistant without explicit
permission.

---

## Pull requests

- One logical change per pull request.
- `npm run check` passes.
- New behaviour comes with a test. Bug fixes come with a test that failed before.
- The description explains *why*, not just what — the diff already says what.
- Fill in the pull request template. It exists to save a round-trip of questions.

## Analysts registry

The analyst registry is curated by the maintainer and **pull requests editing it
directly will be closed**. To suggest an analyst, open a "Suggest an analyst"
issue. This is not gatekeeping for its own sake: an open registry fills up with
whoever shows up, and untangling that afterwards falls on one person.

---

## Code of Conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
