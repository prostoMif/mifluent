# Before the repository goes public

Manual steps that cannot be committed from a file. Work top to bottom — the
first one is a blocker, the rest are ordered by how much they cost to fix later.

## 1. Add the licence file — blocker

The repository claims AGPL-3.0 in `package.json`, `README.md` and every package
manifest, but `LICENSE` is not committed yet. **Without it the repository is
technically unlicensed**, which means nobody may legally use it, and a
paraphrased or reformatted copy of the text does not count.

Fetch the canonical text so it is byte-exact:

```bash
curl -o LICENSE https://www.gnu.org/licenses/agpl-3.0.txt
```

Windows PowerShell:

```powershell
Invoke-WebRequest -Uri https://www.gnu.org/licenses/agpl-3.0.txt -OutFile LICENSE
```

Then check it: the file should be around 34 KB and start with
`GNU AFFERO GENERAL PUBLIC LICENSE` / `Version 3, 19 November 2007`.

## 2. Create the repository and fix the placeholder URLs

The `mifluent` organisation name on GitHub is already taken by someone else, so
the repository lives on a personal account. Nothing is lost by that — moving it
into an organisation later keeps stars, forks and issues, and GitHub redirects
the old address.

- Create the repository **private** first. Flip it to public on release day,
  after the clean-machine check below.
- **Replace `OWNER` everywhere.** Several files carry
  `https://github.com/OWNER/mifluent` as a deliberate placeholder, because a
  wrong-but-plausible URL sends people to a stranger's account:

  ```bash
  grep -rn "OWNER" --exclude-dir=node_modules --exclude-dir=.git .
  ```

  It appears in `CONTRIBUTING.md`, `CHANGELOG.md` and
  `.github/ISSUE_TEMPLATE/config.yml`.

## 3. Turn on the CLA bot

`CONTRIBUTING.md` promises a bot comments on the first pull request. Until it is
installed, that promise is false and contributions arrive uncovered.

- Install [CLA Assistant](https://github.com/cla-assistant/cla-assistant) or the
  `contributor-assistant/github-action`.
- Point it at the CLA text in `CONTRIBUTING.md`.
- Test it against a throwaway pull request before release day.

**This has to exist before the first external pull request.** Collecting
agreements retroactively does not work.

## 4. Repository settings

- **Security → Private vulnerability reporting: enable.** `SECURITY.md` sends
  people there; if it is off, the link 404s.
- **Security → Secret scanning and push protection: enable.** Free on public
  repositories.
- **Discussions: enable** — `.github/ISSUE_TEMPLATE/config.yml` links to it.
- **Branch protection on `main`:** require the CI check to pass. Even solo, this
  is what stops a tired evening push from breaking the build.
- **Actions → Workflow permissions: read-only** by default.

## 5. Check the details that leak

- `CODE_OF_CONDUCT.md` lists a personal email address as the enforcement
  contact. That address becomes public and scrapeable. Swap it for a project
  address once a domain exists.
- Search the tree for `mifluent/mifluent` and fix any URL that does not match the
  real repository path.
- Confirm `.env` is not tracked: `git status --ignored | grep .env`

## 6. Clean-machine check

Clone into an empty directory and run the documented steps exactly as written in
the README — no local shortcuts, no already-installed extras. Anything that only
works because of something already on your machine is a bug report waiting on
day one.

## 7. Release

- Tag `v0.1.0`.
- Fill in `CHANGELOG.md` under a dated heading rather than `Unreleased`.
- Take screenshots for the README before posting anywhere.
