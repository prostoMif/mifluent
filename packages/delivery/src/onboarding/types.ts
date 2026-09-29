/**
 * Types and constants for the Telegram onboarding flow.
 */

import type { PendingOnboarding } from "@mifluent/db/schema";
import type { DiscoveryResult } from "@mifluent/discovery";

export interface OnboardingState extends PendingOnboarding {
  /** Parsed discovery result, available after discovery completes. */
  readonly discoveryResultParsed?: DiscoveryResult | null;
  /** Parsed selected target IDs. */
  readonly selectedTargetIdsParsed?: string[] | null;
}

/** Maximum length for callback_data (Telegram limit is 64 bytes). */
export const CALLBACK_DATA_MAX_BYTES = 64;

/** Callback data prefixes for onboarding buttons. */
export const OnboardingCallbackPrefix = {
  /** Toggle a target in the listing: `t:<index>` */
  TOGGLE_TARGET: "t",
  /** Confirm listing and proceed: `go` */
  CONFIRM: "go",
  /** Add another competitor: `add` */
  ADD_COMPETITOR: "add",
  /** Choose a timezone: `tz:<zone>` */
  TIMEZONE: "tz",
  /** Skip timezone (use default): `tz:skip` */
  TIMEZONE_SKIP: "tz:skip",
} as const;

/** Timezone options presented to the user (6 most common per language + "other"). */
export const TIMEZONE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  ru: [
    "Europe/Moscow",
    "Europe/Kaliningrad",
    "Europe/Samara",
    "Asia/Yekaterinburg",
    "Asia/Novosibirsk",
    "Asia/Vladivostok",
  ],
  en: [
    "UTC",
    "Europe/London",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
  ],
};

/** How often to send progress updates during discovery (milliseconds). */
export const PROGRESS_UPDATE_INTERVAL_MS = 7_500;

/** Maximum number of progress updates before forcing a final one. */
export const MAX_PROGRESS_UPDATES = 10;

/** Free plan target limit (shown in listing). */
export const FREE_PLAN_MAX_TARGETS = 3;

/** Invitation token length for URL. */
export const INVITATION_TOKEN_LENGTH = 32;
