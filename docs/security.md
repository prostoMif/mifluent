# Security rules for writing code

These rules apply to every change, not to a pre-release audit. If a rule here
conflicts with something being convenient, the rule wins.

Mifluent is unusual in one specific way, and it shapes this whole document:
**the product deliberately downloads text written by strangers and hands it to a
language model.** Most web-app security advice does not cover that. Sections 1
and 2 are the ones that matter most here, and they are the ones a generic
checklist will not remind you about.

---

## 1. Untrusted text and prompts

Source material — a feed item, a scraped page, an inbound email — is **data**.
It is never an instruction, and it never becomes one by accident.

- **Never interpolate source text into the system portion of a prompt.** System
  instructions and material go in structurally separate places, and the material
  is always wrapped in an explicit frame saying it is untrusted.
- Assume every piece of material is actively trying to: reveal the system
  prompt, flip the classifier's verdict, insert its own link into a digest, or
  impersonate an instruction from the operator. Write the prompt so that
  succeeding at any of these is not possible, and write a test for each.
- **Model output is validated against a Zod schema.** If it does not parse, that
  is an error. It is never an invitation to guess, repair, or retry with a looser
  parser.
- Handle empty, truncated and absurdly large model responses explicitly.
- **Every claim carries a verbatim quote, and the quote is verified against the
  source by exact string match.** No match, the claim is dropped. This is both an
  anti-hallucination measure and an anti-injection measure — do not weaken it to
  fuzzy matching to make a test pass.
- **Links extracted from material never reach a digest unchecked.** Scheme and
  host are validated first. Otherwise an injection puts a phishing link into a
  message the user trusts.
- Never send to a model: secrets, environment contents, system configuration, or
  another tenant's data.
- Log the prompt version, model and parameters. Do not log secrets or personal
  data.

## 2. Fetching user-supplied URLs

Users add sources by URL. This is a server-side request forgery surface by
design, so treat every outbound fetch as hostile input.

- **Allowlist on the resolved IP, not the URL string.** A hostname the attacker
  controls can resolve to `127.0.0.1`.
- Block private and special ranges: `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` (cloud metadata), and the
  IPv6 equivalents.
- **Re-check the resolved IP on every redirect.** The classic bypass is a public
  first hop redirecting to `169.254.169.254`.
- Cap redirects at 3–5.
- **Only `http` and `https`.** Reject `file://`, `gopher://`, `ftp://`,
  `dict://`, `data://`.
- Guard against DNS rebinding: resolve once, then connect to the resolved
  address — do not resolve a second time between check and use.
- Connect timeout, read timeout, and a response size cap that aborts mid-stream.
- Feeds are XML: **disable external entities and DTD processing.** Limit nesting
  depth when parsing XML and JSON.
- Sanitise HTML on the way in *and* on the way out. Escape untrusted text
  wherever it is rendered — in the app, and in email.
- Links rendered from source content get `rel="noopener noreferrer nofollow"`.
- The inbound email address accepts mail from anyone. Check SPF and DKIM, and do
  not treat an unverified sender as a known analyst.

## 3. Tenant isolation

The highest-severity bug class in this project.

- `tenant_id` on every table, in every query.
- The data access layer must make a query without `tenant_id` **impossible**,
  not merely discouraged. "Remember to add it" is not a control.
- Never load an object by ID alone and return it. Check ownership first — this
  is the IDOR/BOLA hole that shows up in most SaaS products.
- Tests for horizontal escalation (tenant A reading tenant B) and vertical
  escalation (a member performing an owner action) are not optional.

## 4. Secrets and BYOK keys

- No secrets in code. Ever. Configuration is environment variables only.
- **Never invent a plausible-looking placeholder credential.** A fake key that
  looks real gets committed, then trusted.
- BYOK keys are encrypted at the field level with a key from the environment
  that is separate from the session secret.
- After saving, a key is only ever displayed as its last four characters.
- Keys never appear in: logs, exports, error messages, URLs or query strings,
  analytics events.
- Verify a key belongs to the current tenant before using it.
- `.env.example` contains no real values.

## 5. Authentication and authorisation

- Passwords hashed with argon2 or bcrypt. No hand-rolled cryptography.
- Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax` or stricter.
- Rotate the session identifier on login and on password change. Invalidate all
  sessions on password reset.
- No user enumeration: identical response and comparable timing for "account
  exists" and "does not" — on login, registration and password reset.
- Password reset tokens are single-use, short-lived, and stored hashed.
- Rate limits are per-scenario. Login, password reset, invitations and outbound
  email each need their own — a global application rate limit does not cover
  them.
- Permissions are checked on every server action and API route. Hiding a button
  is not authorisation.

## 6. Database and input

- Parameterised queries only. No string concatenation into SQL.
- Every input validated server-side, even when the client already validated it.
- CSRF protection on state-changing forms.
- Errors surface a code and a safe message. Stack traces, internal paths and
  driver errors never cross the API boundary.

## 7. Dependencies and supply chain

- Fixed versions, lock file committed, integrity checked in CI.
- **Confirm a package exists before adding it.** Assistants regularly suggest
  libraries that do not exist, and attackers register those exact names to catch
  the resulting installs. Open the package page and look.
- Scan dependencies and the built image for known vulnerabilities.
- Pin third-party GitHub Actions to a commit SHA, not a floating tag — tags can
  be moved.
- `GITHUB_TOKEN` gets minimum permissions.
- The container does not run as root.
- A secret scanner runs in CI so a key cannot reach a public repository.

## 8. Data and privacy

- Deleting an account clears everything: profile, topics, logs, derived data,
  queue entries, cache, object storage, vector index.
- Telemetry is **off by default**, requires explicit consent, and carries counters
  only — never content.
- Logs from someone else's self-hosted instance stay on their instance. Shipping
  them anywhere is both a legal problem and, correctly, a reputational one the
  first time somebody watches their own outbound traffic.
- Backups are encrypted, and restoring from one is tested — an unverified backup
  is not a backup. The encryption key does not live in the same backup as the
  data.

---

## Mark it for review

Add `// TODO: security review` when touching:

authentication · authorisation · cryptography · payments · file handling ·
anything that fetches a user-supplied URL · anything that assembles a prompt

## Things an assistant must not do without being asked

- Edit or apply database migrations
- Change CI/CD configuration
- Modify authentication or authorisation files
- Run destructive commands (`DROP`, `TRUNCATE`, `rm -rf`, force push)
- Touch a production database

---

The full pre-release security checklist — including one-off tasks that are not
per-change rules — is maintained separately by the maintainer and is not part of
this repository.
