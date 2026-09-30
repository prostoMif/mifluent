import { getConfig } from "@mifluent/core";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const config = getConfig();
  const instanceName = config.APP_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <main className="legal-page">
      <h1>Privacy Policy</h1>
      <p className="legal-meta">Last updated: September 2026. Applies to {instanceName}.</p>

      <section>
        <h2>What we store</h2>
        <ul>
          <li>
            <strong>Email address</strong> — for magic-link sign-in and digest delivery.
          </li>
          <li>
            <strong>Telegram user ID</strong> — only if you choose Telegram delivery, to send the
            digest to your chat.
          </li>
          <li>
            <strong>Business profile</strong> — the name, description, monetisation model,
            platforms, target countries and other facts you confirm during onboarding.
          </li>
          <li>
            <strong>Watch targets & sources</strong> — the competitors, platforms and conditions you
            choose to monitor, and the feeds / pages / APIs we poll for each.
          </li>
          <li>
            <strong>Your decisions</strong> — which targets you keep, which surfaces you enable, and
            any manual competitors you add.
          </li>
          <li>
            <strong>Operational data</strong> — hashed IP address (rate limiting), timestamps, job
            statuses, and model-cost logs.
          </li>
        </ul>
      </section>

      <section>
        <h2>Where your data lives</h2>
        <p>
          All data is stored on a virtual private server in <strong>Finland (EU)</strong>. The
          database is PostgreSQL; backups are encrypted and kept in the same region.
        </p>
      </section>

      <section>
        <h2>Sub-processors</h2>
        <ul>
          <li>
            <strong>Model provider</strong> — the LLM API configured via <code>LLM_BASE_URL</code>{" "}
            (e.g. a self-hosted vLLM, OpenAI, Anthropic, or any OpenAI-compatible endpoint). Only
            the business profile and the raw text we fetch from your sources are sent; no email or
            Telegram ID leaves this server.
          </li>
          <li>
            <strong>Email provider</strong> — the SMTP server configured via <code>SMTP_*</code>{" "}
            variables. Receives only the recipient address and the plain-text digest or magic link.
          </li>
        </ul>
      </section>

      <section>
        <h2>Model training</h2>
        <p>
          <strong>Your data is never used to train or fine-tune any model.</strong> The LLM is
          called with a system prompt and the fetched material as untrusted input; the conversation
          is not logged by the model provider beyond their standard retention (typically 30 days for
          abuse monitoring).
        </p>
      </section>

      <section>
        <h2>How to delete your data</h2>
        <p>
          Email the instance owner (address shown in the footer of every digest) and request
          deletion. A manual process will remove your account, profile, targets, sources and all
          associated logs within 30 days. A self-service delete button is planned for a future
          release.
        </p>
      </section>

      <section>
        <h2>Retention</h2>
        <ul>
          <li>Raw fetched items: 30 days.</li>
          <li>Digests sent: 90 days (for your reference).</li>
          <li>Cost & job logs: 1 year (aggregated, no content).</li>
          <li>Account & profile: until you request deletion.</li>
        </ul>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          We use only essential, first-party cookies: a session cookie (Better Auth), a short-lived
          onboarding cookie (24 h), and an optional invitation cookie (1 h). No analytics,
          advertising or third-party cookies.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Questions about this policy: email the instance owner.</p>
      </section>
    </main>
  );
}
