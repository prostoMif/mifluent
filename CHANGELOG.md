# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because Mifluent is self-hosted, every entry is written for the person who has to
decide whether to pull a new image. Breaking changes and required manual steps go
first, in plain language.

## [Unreleased]

### Breaking — manual steps when updating

- **Payments moved from Prodamus to ЮKassa.** Remove `PRODAMUS_*` from `.env`
  and set `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` (and `YOOKASSA_ALLOW_USD`
  only if the shop takes foreign currency). In the ЮKassa dashboard, set the
  notification URL to `https://<host>/api/billing/yookassa` with the events
  `payment.succeeded` and `payment.canceled`. Migration `0016` changes the
  default payment provider; it runs on start.
- **Production refuses to start with `LLM_PRICE_*` at 0** while a model is
  configured and `DAILY_COST_CAP_USD` is above 0: the cap is computed from
  those prices and never triggered before.
- New optional settings for the legal pages: `OPERATOR_NAME`, `OPERATOR_INN`,
  `OPERATOR_TELEGRAM`.

### Fixed

- A clean checkout now builds: `@mifluent/domain` no longer imports
  `@mifluent/digest` (the time-zone check moved to `@mifluent/core`), and
  `digest` and `delivery` declare the packages they use. Before, `tsc --build`
  — and so `docker compose build` — failed on any machine without old `dist/`
  folders.
- CI runs on `master`, the branch the code lives on, and builds before testing.
- The discovery cache matches the exact site: `https://a.ru` no longer returns
  the cached result for `https://spa.ru`, and `%`/`_` in an address are literal.
- Discovery retries once after a rate limit or an unavailable model instead of
  failing the visitor's onboarding.
- News and Reddit searches are polled every 4 hours instead of every hour, so
  one server does not get blocked by Google for automated queries.
- `/privacy` and `/terms` were English-only and named a server in Finland and
  Finnish law. They are now the Russian offer and 152-ФЗ policy (with an
  English summary): server in Russia, ЮKassa, refunds within 14 days. New
  `/contacts` page; all three are in the sitemap.
- The bot shows the offer and the privacy policy with its first question.
- The landing page's comparison with Changeflow and its description of
  marketplace sources match what the product actually does.

### Added

- `npm run account:delete` — erase a customer's business and data on request,
  as the privacy policy promises.
- Every ЮKassa payment sends the owner a Telegram reminder to file the receipt
  in «Мой налог».
- `leads:brief` writes a first message without a price (a sales offer sent
  without consent is advertising under 38-ФЗ) and the offer for those who
  reply, in `leads-out/reply-to-yes.txt`.

### Added

- Repository foundation: contribution guide with CLA, code of conduct, security
  policy, issue and pull request templates.
- Written conventions: `AGENTS.md`, `docs/code-style.md`, `docs/security.md`.
- Toolchain: TypeScript in strict mode, Biome for linting and formatting,
  pre-commit and commit-message hooks, Vitest, GitHub Actions.
- `@mifluent/core`: application error type, API response envelope, structured
  logger with automatic redaction of secret-looking fields, UUIDv7 generator.
- `@mifluent/db`: full Drizzle schema — tenants and membership, watch profiles
  with versioning, sources and their health, raw items with chunks and vector
  embeddings, events and verified facts, digests with separated card blocks,
  the analyst registry, user action and cost logs, encrypted provider keys —
  plus the tenant-scoping helpers.
- Development database via `docker-compose.dev.yml` (PostgreSQL 17 with
  pgvector).

### Not done yet

- `LICENSE` is not committed. See `docs/before-going-public.md`.
- No migrations have been generated; the schema has never been applied.
- Nothing in this repository has been run.

[Unreleased]: https://github.com/prostoMif/mifluent/commits/master
