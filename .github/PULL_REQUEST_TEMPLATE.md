<!--
Thanks for contributing. Fill this in — it saves a round-trip of questions.

A CLA bot will comment on your first pull request. Signing takes one click and
is remembered for every future contribution.
-->

## What this changes

<!-- One or two sentences. The diff already says what; say why. -->

## Why

<!-- What problem does this solve? Link the issue if there is one: Closes #123 -->

## How to check it

<!-- Steps a reviewer can follow to see it working. -->

---

## Checklist

- [ ] `npm run check` passes (lint, format, types)
- [ ] Behaviour that changed has a test; a bug fix has a test that failed before
- [ ] I read [AGENTS.md](../AGENTS.md) and followed
      [docs/code-style.md](../docs/code-style.md)
- [ ] One logical change — unrelated cleanups are not bundled in

## If this touches data

- [ ] Every query includes `tenant_id`
- [ ] No object is returned by ID without an ownership check
- [ ] Any migration is forward-only and generated with `drizzle-kit generate`

## If this touches prompts, fetching, or auth

- [ ] Source text is passed as data, never inside the system prompt
- [ ] Model output is validated against a Zod schema
- [ ] Outbound URL fetches re-check the resolved IP on every redirect
- [ ] No secret appears in logs, errors, URLs, or exports
- [ ] `// TODO: security review` added where appropriate

## Anything a reviewer should push back on

<!-- Shortcuts taken, things you were unsure about, decisions worth a second
     opinion. Saying "none" is fine. -->
