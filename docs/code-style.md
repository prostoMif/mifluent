# Code style

The point of this document is that a stranger — or the same person six weeks
later — can open any file and find it laid out the way they expected.

Formatting is not discussed here. Biome owns formatting; run `npm run format`
and move on. This document covers the decisions a formatter cannot make.

---

## 1. Language rules

### `any` is banned

`strict: true` is on and `any` is a lint error. When a type is genuinely unknown,
use `unknown` and narrow it:

```ts
// wrong
function parse(payload: any) {
  return payload.items;
}

// right
function parse(payload: unknown): Item[] {
  const result = itemsSchema.safeParse(payload);
  if (!result.success) {
    throw new AppError("invalid_payload", "Could not read the response.", {
      issues: result.error.issues,
    });
  }
  return result.data;
}
```

The same applies to `as`. A type assertion tells the compiler to stop checking,
which is exactly the wrong instinct at a boundary where data arrives from
outside. Validate instead of asserting. The narrow exception is a cast that is
provably safe and carries a comment saying why.

### Exported functions carry explicit return types

Inference is fine inside a function body. On an exported signature it is not:
the type becomes whatever the implementation happens to return today, and a
refactor silently changes the contract.

```ts
// wrong — the contract is accidental
export function buildDigest(profileId: string) { ... }

// right — the contract is stated
export function buildDigest(profileId: string): Promise<Digest> { ... }
```

### Prefer narrow types over wide ones

A union of literals beats a `string` almost every time. Status columns, job
names, source kinds and log event names are all closed sets — model them as
closed sets, and the compiler finds the missing switch branch for you.

```ts
export type SourceKind =
  | "rss"
  | "reddit"
  | "hacker_news"
  | "google_news"
  | "email_inbox"
  | "page_diff";
```

### No default exports

Named exports only. Default exports rename themselves at every import site,
which defeats search and makes automated refactors unreliable. The exception is
where a framework demands it — Next.js pages, layouts and route handlers.

### `const` everywhere, `let` when you must, `var` never

### Async

`async`/`await` throughout. No raw `.then()` chains, no mixing the two styles in
one function. A promise that is deliberately not awaited gets `void` in front of
it and a comment saying why.

### Dates

There is no such thing as local time inside this codebase. Everything is UTC,
every column is `timestamptz`, and conversion to a user's zone happens at the
rendering boundary and nowhere else. A function that accepts a date without a
zone is a review failure.

---

## 2. Naming

The full table lives in [CONTRIBUTING.md](../CONTRIBUTING.md#naming-conventions).
Two rules deserve repeating because they are the ones that erode:

**No abbreviations** except `id`, `url`, `api`. Not `usr`, not `cfg`, not `tmp`,
not `msg`. Abbreviations are how a codebase ends up with `userConfig`,
`usrCfg` and `userSettings` all meaning the same thing.

**Booleans are questions.** `isActive`, `hasQuote`, `canRetry`. Never
`active`, `flag`, `status2`.

Functions are verb phrases: `buildDigest`, `fetchSource`, `verifyQuote`. A
function called `data` or `handle` tells the reader nothing.

---

## 3. File and module layout

### One responsibility per file

If a file needs the word "and" to describe it, split it. A soft ceiling of
roughly 300 lines is a useful smell test, not a rule — a long file of pure data
is fine, a long file of tangled control flow is not.

### File order

Inside a file, top to bottom:

1. Imports
2. Types and interfaces
3. Constants
4. The main exported function or class
5. Helpers used only by the above

Readers arrive looking for the exported thing. Put it where they look.

### Import order

Biome sorts imports automatically. The grouping is: node builtins, external
packages, workspace packages (`@mifluent/*`), then relative imports.

### Dependencies point inward

```
apps/web  →  packages/*
packages/* →  packages/core
```

A package never imports from `apps/`. `packages/core` never imports from another
package. If you need the arrow to go the other way, the thing you need belongs in
`core`.

---

## 4. Function shape

### Guard clauses over nesting

```ts
// wrong
function handle(source: Source): Result {
  if (source.isActive) {
    if (source.lastPolledAt !== null) {
      if (isDue(source)) {
        return poll(source);
      }
    }
  }
  return skip();
}

// right
function handle(source: Source): Result {
  if (!source.isActive) return skip();
  if (source.lastPolledAt === null) return poll(source);
  if (!isDue(source)) return skip();
  return poll(source);
}
```

Three levels of indentation inside a function is the point at which to extract
a helper.

### Arguments

Three positional parameters is the ceiling. Beyond that, take a named object —
call sites stop depending on argument order, and a boolean stops being a mystery:

```ts
// wrong — what is `true`?
await buildDigest(profileId, "daily", true);

// right
await buildDigest({ profileId, period: "daily", includeEmpty: true });
```

### No business logic in route handlers

A handler does three things: validate input, call a package, shape the response.
Anything else belongs in a package where it can be tested without HTTP.

```ts
// apps/web/app/api/watch-profiles/[id]/sources/route.ts
export async function POST(request: Request, { params }: RouteContext) {
  const body = createSourceSchema.parse(await request.json());
  const source = await createSource({ tenantId: session.tenantId, ...body });
  return ok(source);
}
```

---

## 5. Errors

One error class, `AppError`, used everywhere:

- `code` — a stable, machine-readable string. Clients and tests match on it.
- `message` — safe to show a user. No internals, no SQL, no paths.
- `details` — context for the log. Never serialised to a client.

```ts
throw new AppError("source_unreachable", "This source could not be reached.", {
  sourceId,
  status: response.status,
});
```

Rules:

- **Never swallow an error.** An empty `catch` block is a review failure. If an
  error is genuinely ignorable, log it at `warn` and say why in a comment.
- **Never catch what you cannot handle.** Catching in order to re-throw the same
  thing adds noise and loses the stack.
- Catch narrowly. Wrap the one call that can fail, not the whole function body.
- Stack traces, internal paths and driver errors never cross the API boundary.

---

## 6. API responses

Every endpoint returns one of two shapes, and nothing else:

```ts
// success
{ "data": { ... } }

// failure
{ "error": { "code": "source_unreachable", "message": "..." } }
```

Helpers `ok()` and `fail()` live in `packages/core` and every handler uses them.
A client should never have to guess which shape came back or parse a status code
to find out.

---

## 7. Validation

Zod at every boundary where data enters the process:

- HTTP request bodies, query strings and route parameters
- Environment variables (one schema, at startup, fail fast)
- Model responses
- Anything parsed out of a feed, a page, or an email

Inside the process, past a validated boundary, trust the types. Re-validating
the same object at four layers is noise that hides the one place that matters.

---

## 8. Logging

Structured JSON, one event per line, using the shared logger. `console.log`
does not appear in committed code.

```ts
logger.info("digest.delivered", { tenantId, profileId, cardCount });
```

Event names follow `<domain>.<past-tense-action>` — the same names that appear
in the naming table, because they end up in analytics and in the user action log.

Levels:

| Level | Means |
|---|---|
| `debug` | Only useful while working on this specific thing |
| `info` | Expected and happened: source polled, digest delivered |
| `warn` | Degraded but handled: source failed, will retry |
| `error` | A human needs to look at this |

**Never logged, at any level:** model API keys, passwords, session tokens, reset
tokens, full email bodies, or personal data beyond an identifier.

---

## 9. Comments

Comment the *why*, never the *what*. The code already says what it does.

```ts
// pointless
// increment the counter
counter += 1;

// useful
// Re-resolve on every hop: the first host can be public and the redirect
// target private. See docs/security.md.
const ip = await resolveAndCheck(redirectUrl);
```

Every non-obvious constant gets a sentence explaining where the number came
from. A `5` with no explanation becomes untouchable — nobody dares change a
number they cannot justify.

`TODO` comments carry a name or an issue number. An anonymous `TODO` is
decoration.

Comments and names are written in English.

---

## 10. Tests

- Test names read as sentences: `returns null when the quote is missing from the source`.
- Arrange, act, assert — with blank lines between the three.
- One behaviour per test. A test asserting five unrelated things tells you
  nothing useful when it fails.
- No shared mutable state between tests. Each test builds what it needs.
- Do not test the framework, the ORM, or the standard library.

The three areas where tests are not optional: tenant isolation, quote
verification, and job idempotency. Everything else is judgement.

---

## 11. Dependencies

- Fixed versions. The lock file is committed.
- Before adding a package: open its page and confirm it exists, is maintained,
  and is what you think it is. Assistants routinely invent plausible package
  names, and attackers register those names — see
  [docs/security.md](security.md).
- A new dependency arrives with a sentence in the pull request explaining why the
  standard library or an existing dependency will not do.
- Prefer no dependency over a small one. Prefer a small one over a framework.

---

## 12. What a reviewer will actually check

In order:

1. Does it break an architecture rule? (cascade order, classifier, quote
   verification, tenant isolation, untrusted text)
2. Is `tenant_id` in every query it touches?
3. Is anything untrusted reaching a prompt, a URL fetch, or the DOM unchecked?
4. Are errors handled explicitly, and do they leak anything?
5. Is it typed honestly, with no `any` and no unexplained `as`?
6. Would a stranger understand it without asking a question?
7. Is there a test for the behaviour that changed?
