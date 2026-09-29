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
      "List-Unsubscribe": `<${options.feedbackEmail}>, <${config.APP_URL}/unsubscribe/>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Reply-To": options.feedbackEmail,
    },
  };

  await transport.sendMail(mailOptions);

  logger.info("email.digest_sent", { to: options.to, subject: options.rendered.subject });
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
