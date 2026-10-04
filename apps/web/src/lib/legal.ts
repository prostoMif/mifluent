/**
 * The operator's details and the reader's language, for the legal pages.
 *
 * The details come from the environment (OPERATOR_*), never from the
 * repository: they are a real person's name and tax number. A missing value
 * is shown as a visible gap rather than a made-up placeholder, so an unfinished
 * page is obvious before a payment provider's moderator sees it.
 */

import { getConfig } from "@mifluent/core";
import { headers } from "next/headers";

export interface Operator {
  readonly name: string;
  readonly inn: string;
  readonly email: string;
  readonly telegram: string;
  readonly site: string;
}

const MISSING = "[не указано]";

export function getOperator(): Operator {
  const config = getConfig();
  return {
    name: config.OPERATOR_NAME ?? MISSING,
    inn: config.OPERATOR_INN ?? MISSING,
    email: config.FEEDBACK_EMAIL ?? config.SMTP_FROM ?? MISSING,
    telegram: config.OPERATOR_TELEGRAM ?? MISSING,
    site: config.APP_URL.replace(/^https?:\/\//, "").replace(/\/$/, ""),
  };
}

/** Russian unless the browser asks for something else first. */
export async function legalLanguage(): Promise<"ru" | "en"> {
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.trim() === "" || accept.toLowerCase().startsWith("ru") ? "ru" : "en";
}
