# Mifluent

**Monitoring that works out what to monitor.**

Tell Mifluent what your business does. It works out which competitors, which
platforms you depend on and which rules apply to you — then every morning tells
you what changed and what that means for you.

> **Status: pre-alpha.** The repository foundation is in place; the product is
> being built in the open. Nothing here runs yet. Watch the repo or check
> [CHANGELOG.md](CHANGELOG.md) for progress.

## What it does

Every other monitoring tool starts by asking you what to watch. That is the part
you cannot do well — you would have to already know which competitor is about to
move, which platform is about to change its terms, and which rule is about to
start applying to you. Knowing that is the job you were trying to hand over.

So Mifluent starts from the other end. You describe your business once, or point
it at your site. It proposes what is worth watching — competitors, the platforms
and suppliers you depend on, the external conditions that move your market — and
shows you that list to confirm before it starts.

From then on, every morning you get a short digest of what actually changed,
with an explanation of why it matters to *your* business, a verbatim quote, and
a link to the original source.

Each card is built from four clearly separated parts:

1. **The fact** — a verbatim quote plus a link to the primary source.
2. **Why it touches you** — tied to your own business description.
3. **What an analyst said** — a link to an independent take, when one exists.
4. **Model interpretation** — explicitly labelled as such.

If nothing relevant happened, you still get a digest telling you what was
checked and why nothing passed. Silence reads like a broken pipeline.

## Design principles

- **Filtering beats volume.** An empty day stays empty. Padding a quiet morning
  with generic news rebuilds the noise you left behind.
- **Facts are separated from opinion**, in the product and in the sources it
  draws on.
- **Nothing is asserted without a quote.** Extracted claims are checked for an
  exact match against the source; if the quote is not found, the claim is
  dropped automatically.
- **Relevance is decided by a trained classifier** over embeddings, not by
  asking a language model to score things from 1 to 10.
- **Your keys, your data.** Bring your own model key. Self-host it and nothing
  leaves your machine.

## Running it

Not yet. When the first release lands, this section becomes a `docker compose up`
and a short list of environment variables.

## Tech

TypeScript in strict mode, Next.js (App Router), PostgreSQL with pgvector,
Drizzle ORM, pg-boss for the queue, Better Auth, LiteLLM for model access, and
local embeddings — no Redis, no separate broker. Multi-tenant from the first
commit so the hosted version and the self-hosted one stay one codebase.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers the conventions this
project holds to and the contributor licence agreement every pull request needs.
Bug reports and broken-source reports are welcome from day one.

## Licence

[AGPL-3.0](LICENSE). If you run a modified version as a network service, you
have to publish your changes.
