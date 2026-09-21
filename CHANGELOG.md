# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because Mifluent is self-hosted, every entry is written for the person who has to
decide whether to pull a new image. Breaking changes and required manual steps go
first, in plain language.

## [Unreleased]

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
