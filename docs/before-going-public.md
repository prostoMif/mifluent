# Going public — checklist

The repository [prostoMif/mifluent](https://github.com/prostoMif/mifluent) is
public and CI runs on `master`. This file records what was already done and
what remains from the original pre-release checklist. Delete DONE entries each
time you check, so the file only lists actual work.

## DONE

- **Licence.** The canonical AGPL-3.0 text is committed as `LICENSE`
  (~34 KB, starts with `GNU AFFERO GENERAL PUBLIC LICENSE`), and matches the
  `license` field in every package manifest.
- **Repository and URLs.** The repository lives on the personal account
  (`prostoMif/mifluent`); the `OWNER` placeholder was replaced everywhere
  (`CONTRIBUTING.md`, `README.md`, side entrypoints,
  `.github/ISSUE_TEMPLATE/config.yml`, `packages/core/src/runtime.ts`).
- **CoC contact.** `CODE_OF_CONDUCT.md` sends reports to the maintainer on
  GitHub (`@prostoMif`), not to a personal email that would be public and
  scrapeable.
- **Secrets.** `.env` and `.env.local` are not tracked and are covered by
  `.gitignore`; `git log` contains no credentials.
- **Third-party actions pinned.** `ci.yml` pins `actions/checkout` and
  `actions/setup-node` to commit SHAs, so a moved tag cannot change what CI
  runs.

## To check — repository settings (read-only look, then fix what is off)

`SECURITY.md` and the issue templates make promises about GitHub settings.
Each of these is a two-minute toggle:

- **Security → Private vulnerability reporting: enabled.** If it is off, the
  link in `SECURITY.md` 404s.
- **Security → Secret scanning and push protection: enabled.** Free on public
  repositories.
- **Discussions: enabled** — `.github/ISSUE_TEMPLATE/config.yml` links to it.
- **Branch protection on `master`** (the branch the code lives on): require
  the CI checks. Even solo, this is what stops a tired evening push from
  breaking the build.
- **Actions → Workflow permissions: read-only** by default.

## To do — CLA bot

`CONTRIBUTING.md` promises a bot comments on the first pull request. Until it
is installed, that promise is false and contributions arrive uncovered.

- Install [CLA Assistant](https://github.com/cla-assistant/cla-assistant) or
  the `contributor-assistant/github-action`.
- Point it at the CLA text in `CONTRIBUTING.md`.
- Test it against a throwaway pull request.

## To do — clean-machine check

Clone into an empty directory and run the documented steps exactly as written
in the README — no `.env` lying around, no pre-installed extras, nothing at
all. Anything that only works because of something already on your machine is
a bug report waiting on day one.

## To do — release hygiene

- Tag `v0.1.0`.
- Replace the `Unreleased` heading in `CHANGELOG.md` with dated versions
  (`v0.1.0 — 2026-10-..`) from then on, instead of accumulating one long
  section.
- Take two or three screenshots for the README before posting the repository
  anywhere.
