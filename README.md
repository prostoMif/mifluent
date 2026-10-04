# Mifluent

**Monitoring that works out what to monitor.**

Point Mifluent at your website. It proposes which competitors, platforms and
rules are worth watching, you confirm the list, and from then on it tells you
what changed and why it matters to *your* business — every line with a quote
and a link to where it came from.

> **Status: pre-release.** The pipeline, delivery, onboarding and payments are
> built and covered by tests, but the hosted service has not taken its first
> customer yet. Expect rough edges.

## What it does

1. **Discovery.** You give a site (or a sentence about the business). A cheap
   language model reads the site and proposes 3–8 targets — competitors,
   platforms you depend on, external conditions — from what it knows; code
   then finds where each one publishes changes: feeds, changelogs, pricing
   pages, job boards, Telegram and YouTube channels, news searches. You edit
   the list before anything is watched. Competitors the model does not know
   (a small local business, say) you add yourself.
2. **Collection.** RSS/Atom feeds, public ATS job boards (Greenhouse, Lever,
   Ashby), text diffs of public pages, Google News and Reddit searches, and
   shared *source packs* for platforms and regulators by country
   (`packs/`). Nothing behind a login: a marketplace's own seller offer is
   followed through the news about it.
3. **Selection.** Local embeddings (multilingual-e5-small) narrow the day's
   material; a cheap model decides "relevant to this business, and to which
   target" for articles and "a material change, and of what kind" for page
   diffs and job postings. Every rejection keeps its reason.
4. **Extraction.** Facts come with a verbatim quote that code finds in the
   stored text; a quote that is not there is dropped, never matched fuzzily.
   For news items the stored text is the feed's title and snippet.
5. **Delivery.** A Telegram bot (with a Mini App) or e-mail: urgent changes
   (price, plan, policy) the same day, everything else in a daily or weekly
   digest. An empty week still says what was checked.

## Running it

```sh
cp .env.production.example .env   # fill it in — every line says how
docker compose up -d
```

The full guide, including hosting in Russia (152-ФЗ, models through an
intermediary, ЮKassa), is in [docs/deploy.md](docs/deploy.md).

Self-hosted instances use their own model key (`LLM_BASE_URL`, `LLM_API_KEY`,
any OpenAI-compatible API). The hosted service includes model costs in the
price.

## Tech

TypeScript in strict mode, Next.js (App Router), PostgreSQL with pgvector,
Drizzle ORM, pg-boss for the queue, Better Auth, a small in-repo adapter for
OpenAI-compatible model APIs, and local embeddings — no Redis, no separate
broker. Multi-tenant, so the hosted version and the self-hosted one are one
codebase.

```sh
npm ci
npx tsc --build      # workspace packages compile to dist/
npm test             # Vitest, including tests against an in-process Postgres
npm run check        # Biome, types and tests
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers the conventions this
project holds to and the contributor licence agreement every pull request needs.
Bug reports and broken-source reports are welcome.

## Licence

[AGPL-3.0](LICENSE). If you run a modified version as a network service, you
have to publish your changes.
