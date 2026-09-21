/**
 * Outgoing email.
 *
 * Plain text only, and that is a decision rather than a stage. An HTML email
 * means an HTML template, which means escaping user-supplied text in a second
 * rendering path that nobody looks at — and the only messages this sends are a
 * password reset link and, later, a digest that is mostly prose anyway.
 *
 * Email is optional. An instance with no SMTP settings starts normally and
 * simply cannot offer password reset; the screens say so rather than failing
 * at the moment somebody needs them.
 *
 * // TODO: security review — handles account recovery
 */

import { AppError, getConfig } from "@mifluent/core";
import { createTransport, type Transporter } from "nodemailer";
import { logger } from "./logger";

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export function isEmailConfigured(): boolean {
  return getConfig().features.email;
}

let transporter: Transporter | undefined;

/**
 * Built once, on first use. Nodemailer keeps a connection pool, and rebuilding
 * it per message means a fresh TLS handshake for every email.
 */
function getTransporter(): Transporter {
  const config = getConfig();

  if (!config.features.email) {
    throw new AppError("configuration_invalid", "Email is not configured on this instance.");
  }

  transporter ??= createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // 465 is implicit TLS; everything else starts in the clear and upgrades
    // with STARTTLS, which nodemailer does on its own when `secure` is false.
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });

  return transporter;
}

export async function sendEmail(email: OutboundEmail): Promise<void> {
  const config = getConfig();

  await getTransporter().sendMail({
    from: config.SMTP_FROM,
    to: email.to,
    subject: email.subject,
    text: email.text,
  });

  // The recipient is logged, the body is not. A password reset link in a log
  // file is a working password reset link.
  logger.info("email.sent", { to: email.to, subject: email.subject });
}
