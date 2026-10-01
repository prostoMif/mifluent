/**
 * Email sending for digests.
 *
 * Uses nodemailer with the same SMTP configuration as the web app's mailer.
 * Runs in the worker process, not the web app.
 */

import { createLogger, getConfig } from "@mifluent/core";
import { createTransport, type SendMailOptions, type Transporter } from "nodemailer";
import type { RenderedEmail } from "./render.js";

const logger = createLogger({ base: { role: "email-sender" } });

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  const config = getConfig();

  if (!config.features.email) {
    throw new Error("Email is not configured on this instance.");
  }

  transporter ??= createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });

  return transporter;
}

export interface SendDigestEmailOptions {
  readonly to: string;
  readonly rendered: RenderedEmail;
  readonly feedbackEmail: string;
  /**
   * The signed one-click address (RFC 8058). The mail provider POSTs
   * `List-Unsubscribe=One-Click` to it, so it is the API route, not the page.
   */
  readonly unsubscribeUrl: string;
}

export async function sendDigestEmail(options: SendDigestEmailOptions): Promise<void> {
  const config = getConfig();
  const transport = getTransporter();

  const mailOptions: SendMailOptions = {
    from: config.SMTP_FROM,
    to: options.to,
    subject: options.rendered.subject,
    text: options.rendered.text,
    html: options.rendered.html,
    headers: {
      "List-Unsubscribe": `<mailto:${options.feedbackEmail}?subject=unsubscribe>, <${oneClickUrl(options.unsubscribeUrl)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Reply-To": options.feedbackEmail,
    },
  };

  await transport.sendMail(mailOptions);

  logger.info("email.digest_sent", { to: options.to, subject: options.rendered.subject });
}

/** `/unsubscribe/<token>` (the page a person opens) → `/api/unsubscribe/<token>` (the POST target). */
function oneClickUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.pathname = url.pathname.replace(/^\/unsubscribe\//, "/api/unsubscribe/");
  return url.toString();
}

export async function verifyEmailConnection(): Promise<boolean> {
  try {
    const transport = getTransporter();
    await transport.verify();
    return true;
  } catch {
    return false;
  }
}
