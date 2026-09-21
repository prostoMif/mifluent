# Security Policy

Mifluent fetches content from URLs that users supply and feeds text written by
strangers to a language model. That makes a handful of vulnerability classes
especially relevant here, and reports about them are genuinely welcome.

## Supported versions

Pre-alpha. Only the latest commit on `main` is supported. Once tagged releases
exist, this section will list which ones still receive fixes.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting instead: go to the **Security** tab
of this repository and click **Report a vulnerability**. That opens a private
thread visible only to the maintainer.

Include, as far as you can:

- what the flaw is and where in the code it lives;
- the steps to reproduce it, ideally a minimal proof of concept;
- what an attacker gets out of it;
- the version or commit you tested.

## What to expect

| Stage | Target |
|---|---|
| First response | within 3 days |
| Assessment and severity call | within 7 days |
| Fix for a critical issue | as fast as I can, and I will keep you posted |

This is a solo project, so these are honest targets rather than a contractual
SLA. If a deadline slips you will hear why, not silence.

## Disclosure

Report privately, and give me a reasonable window to ship a fix before going
public. Once the fix is released I will publish an advisory and credit you by
name, unless you would rather stay anonymous.

## In scope, and especially interesting

- **Server-side request forgery.** Users add sources by URL. Anything that gets
  the fetcher to reach a private address, `localhost`, or a cloud metadata
  endpoint — including via a redirect chain — is a serious bug.
- **Prompt injection.** Source text is data, never instructions. If crafted
  content in a feed, a page, or an inbound email changes the model's verdict,
  injects its own link into a digest, or leaks another part of the prompt, that
  is in scope.
- **Tenant isolation.** Any way to read or write data belonging to another
  tenant is the highest-severity class in this project.
- **Exposure of BYOK model keys** through logs, exports, URLs, error messages,
  or the API.
- **XML external entities** in feed parsing, and anything else that turns a
  hostile feed into code execution or file access.
- Authentication and session handling, injection, stored XSS in rendered source
  content, and CSRF.

## Out of scope

- Vulnerabilities in third-party services (report those to their maintainers).
- Findings from automated scanners with no demonstrated impact.
- Missing hardening headers with no exploit path.
- Denial of service through sheer volume of traffic.
- Social engineering.

## For people self-hosting

Mifluent talks to the open internet on your behalf. Run it behind a firewall
that blocks outbound access to your internal network, keep `ENCRYPTION_KEY` and
`BETTER_AUTH_SECRET` out of version control, and update when advisories land.
