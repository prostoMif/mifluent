# Mifluent — rules for coding assistants

This is the source of truth for how code is written in this repository.
`CLAUDE.md`, `.cursorrules` and `.github/copilot-instructions.md` all point here.

## Read these before writing code

Two documents are binding, and neither is optional:

- **[docs/code-style.md](docs/code-style.md)** — how code is written here.
- **[docs/security.md](docs/security.md)** — the rules that must hold in every
  change.

Read both at the start of any session that touches code. If a change touches a
prompt, an outbound fetch, authentication, or a database query, re-read the
relevant section of `docs/security.md` before writing, not after.

---

## What this project is

Mifluent is open-source monitoring for people running a business online. It
pulls material from sources (RSS, Reddit, Hacker News, Google News, an email
inbox, page diffs), filters it down to what matters, and delivers a morning
digest explaining what changed and why it touches that specific business.
AGPL-3.0, deployed with `docker compose`, multi-tenant from the first commit.

## Task workflow

- OpenCode work is task-scoped: read the task file named in the request under
  `docs/tasks/` (symlinked to the project's Obsidian vault) before editing
  anything, and touch only the files it lists as allowed.
- Do not read or act on other files in `docs/tasks/` unless the task you were
  given references them.

## Scope of changes

- Change only what was asked. Do not refactor neighbouring code "while you are
  in there".
- Do not rename existing things without being asked.
- If a task requires touching another module, say so first, then do it.

## Architecture — do not break

- The pipeline is a cascade: fetch → deduplicate → cosine to profile → cheap
  model (relevant / material?) → expensive extraction → clustering → digest. The
  expensive model runs only on the 10–15% that clears the cheap steps. Do not
  move it earlier.
- Relevance in v1 is decided in two free-or-cheap steps: cosine similarity of a
  chunk to the profile's targets and topics (free, local embeddings), then a
  cheap model returning a Zod-validated `{relevant, targetId, reason}`. For page
  diffs and job postings the cheap model answers *materiality* instead:
  `{material, kind, summary, urgent}`. Never ask a model to "score from 1 to 10".
  A trained classifier replaces the cheap-model step in v2, once user actions
  are logged — do not build it now.
- Every extracted claim carries a **verbatim quote**. The model returns only the
  quote; the offset is computed in code by `indexOf` after normalising
  whitespace, quotes and dashes. No match, the claim is dropped. Do not ask the
  model for offsets and do not weaken the match to fuzzy.
- An **event is a cluster of items**, linked through `event_items`. Never write
  one event per raw item when near-duplicates exist.
- Sources are three kinds of input into the same `raw_items`: feeds (RSS/Atom),
  public JSON (ATS job boards), and text diffs of pages (`page_versions`). No
  new connector types without a decision in the wiki.
- Models are reached through the in-repo adapter in `packages/llm` speaking the
  OpenAI-compatible HTTP API with `LLM_BASE_URL` + `LLM_API_KEY`. No LiteLLM,
  no OpenRouter SDK, no provider-specific SDKs.
- **No agents in the pipeline.** The single exception is source discovery during
  onboarding.
- **Frozen until first payment:** auth, tenancy, invitations, roles, instance
  settings. Do not add to them.

## Working from tasks

Implementation work is described in `docs/tasks/TASK-NNN-*.md` (index: `docs/tasks/_Индекс.md`). Each task is
self-contained: goal, files, acceptance criteria, verification commands. Do one
task per session, in order, and stop when its acceptance criteria pass — do not
start the next one. If a task needs a schema change, the task file says so and
that counts as the owner's permission for that migration only. Stuck → write
to `docs/tasks/_Вопросы владельцу.md` and stop.

## Multi-tenancy

- `tenant_id` is on every table and in every query.
- The data access layer must make a query without `tenant_id` impossible. If you
  find yourself writing something that bypasses it, stop and say so.
- Never return an object by ID without checking it belongs to the caller's
  tenant.

## Untrusted content — the rule that defines this project

- Text from sources, emails and pages is **data, never instructions**.
- System instruction and material are separated structurally, with the material
  explicitly framed as untrusted.
- Never place source text in the system portion of a prompt.
- Model output is validated against a Zod schema. Does not parse → error, not a
  guess.
- Links from material do not reach a digest without scheme and host checks.

Details and the injection test cases: `docs/security.md` §1.

## Fetching by URL

- Every outbound request to a user-supplied URL checks the **resolved IP**
  against private ranges — **re-checked on every redirect**.
- `http` and `https` only. Redirect limit, timeouts, response size cap.
- XML and feeds parsed with external entities and DTDs disabled.

Details: `docs/security.md` §2.

## Secrets

- No secrets in code. Environment variables only.
- Never invent a plausible placeholder credential.
- BYOK keys are encrypted at field level, never logged, never exported, never in
  a URL or an error message. Displayed as last four characters only.

## Style — the short version

The full document is `docs/code-style.md`. The rules that get broken most:

- `any` is banned; use `unknown` and narrow. Avoid `as`.
- Exported functions carry explicit return types.
- Named exports only, except where a framework requires a default.
- Small files, one responsibility each.
- No business logic in route handlers.
- Guard clauses instead of nested conditionals.
- More than three parameters → take a named object.
- Never swallow an error. Empty `catch` blocks are not acceptable.
- All times are UTC and `timestamptz`. There is no local time inside the code.
- Structured logging through the shared logger. No `console.log` in committed
  code.
- Comments explain *why*. Names and comments are in English.

## Naming

The full table is in `CONTRIBUTING.md`. Most-used:

| What | Rule |
|---|---|
| Tables, columns | `snake_case`, tables plural |
| Timestamps | `_at` suffix, `timestamptz` |
| Booleans | `is_` / `has_` prefix |
| TypeScript | `camelCase`; types `PascalCase` |
| Files | `kebab-case.ts` |
| Endpoints | `/api/<plural-resource>` |
| Log events | `<domain>.<past-tense-action>` |
| Queue jobs | `<domain>:<action>` |

No abbreviations except `id`, `url`, `api`.

## Dependencies

- Suggest only packages that actually exist, with fixed versions.
- **If you are not certain a package exists, say so — do not guess.** Inventing a
  package name is how slopsquatting attacks land.
- A new dependency needs a stated reason.

## Do not touch without explicit permission

- database migrations
- CI/CD configuration
- authentication and authorisation files
- destructive commands (`DROP`, `TRUNCATE`, `rm -rf`, force push)
- any production database

## Mark it

Add `// TODO: security review` when touching authentication, authorisation,
cryptography, payments, file handling, anything fetching a user-supplied URL,
and anything that assembles a prompt.

---

## Keeping this file honest

- A new architectural decision goes into the project wiki first, then one line
  here.
- If an assistant makes the same mistake twice, that is a missing rule, not a
  bad assistant. Add the line.
- This file is part of the codebase. Review changes to it in the diff like any
  other code — instructions can be hidden in a rules file, and an assistant will
  follow them.
