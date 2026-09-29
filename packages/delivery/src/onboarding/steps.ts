/**
 * Step handlers for the Telegram onboarding flow.
 *
 * Each step is a pure function that takes the current state and the user's
 * input, and returns the next state and the messages to send.
 */

import { uuidv7 } from "@mifluent/core";
import type { DiscoveredCondition, DiscoveredTarget, DiscoveryResult } from "@mifluent/discovery";
import { normaliseWebsite } from "@mifluent/discovery";
import { stringsFor } from "../strings.js";
import {
  MAX_PROGRESS_UPDATES,
  OnboardingCallbackPrefix,
  PROGRESS_UPDATE_INTERVAL_MS,
  TIMEZONE_OPTIONS,
} from "./types.js";

/** Build the "awaiting input" message. */
export function buildAwaitingInputMessage(
  language: "en" | "ru",
  isRegistrationOpen: boolean,
  hasInvitation: boolean,
): string {
  const strings = stringsFor(language);
  if (!isRegistrationOpen && !hasInvitation) {
    return strings.onboarding.closedRegistration;
  }
  return strings.onboarding.awaitingInput;
}

/** Build the discovery progress message. */
export function buildDiscoveryProgressMessage(language: "en" | "ru", progressText: string): string {
  const strings = stringsFor(language);
  return strings.onboarding.discoveryProgress(progressText);
}

/** Build the listing message with toggle buttons. */
export function buildListingMessage(
  language: "en" | "ru",
  discoveryResult: DiscoveryResult,
  selectedTargetIds: string[],
  maxTargets: number,
): { text: string; buttons: Array<{ text: string; callbackData: string }> } {
  const strings = stringsFor(language);
  const { business, targets, conditions } = discoveryResult;

  const lines: string[] = [];

  // Business facts
  lines.push(`<b>${strings.onboarding.businessFacts}</b>`);
  lines.push(business.description ?? strings.onboarding.noDescription);
  lines.push("");

  // Targets with toggles
  lines.push(`<b>${strings.onboarding.targets}</b>`);
  lines.push(strings.onboarding.targetLimit(maxTargets));
  lines.push("");

  const allTargets: Array<DiscoveredTarget | DiscoveredCondition> = [...targets, ...conditions];
  const buttons: Array<{ text: string; callbackData: string }> = [];

  for (let index = 0; index < allTargets.length; index++) {
    const target = allTargets[index];
    if (!target) continue;
    const isSelected = selectedTargetIds.includes(target.name.toLowerCase());
    const checkbox = isSelected ? "✅" : "⬜";
    const kindLabel =
      "kind" in target
        ? target.kind === "competitor"
          ? "🏢"
          : target.kind === "platform"
            ? "🔧"
            : "📋"
        : "📋";
    lines.push(`${checkbox} ${kindLabel} ${target.name} — ${target.reason}`);
    buttons.push({
      text: `${checkbox} ${kindLabel} ${target.name}`,
      callbackData: `${OnboardingCallbackPrefix.TOGGLE_TARGET}:${index}`,
    });
  }

  lines.push("");
  lines.push(strings.onboarding.listingActions);

  // Action buttons
  buttons.push({ text: strings.onboarding.go, callbackData: OnboardingCallbackPrefix.CONFIRM });
  buttons.push({
    text: strings.onboarding.addCompetitor,
    callbackData: OnboardingCallbackPrefix.ADD_COMPETITOR,
  });

  return { text: lines.join("\n"), buttons };
}

/** Build the timezone selection message. */
export function buildTimezoneMessage(language: "en" | "ru"): {
  text: string;
  buttons: Array<{ text: string; callbackData: string }>;
} {
  const strings = stringsFor(language);
  const options = TIMEZONE_OPTIONS[language] ?? TIMEZONE_OPTIONS["en"] ?? [];

  const buttons: Array<{ text: string; callbackData: string }> = [];
  for (const zone of options) {
    buttons.push({ text: zone, callbackData: `${OnboardingCallbackPrefix.TIMEZONE}:${zone}` });
  }
  buttons.push({
    text: strings.onboarding.otherTimezone,
    callbackData: OnboardingCallbackPrefix.TIMEZONE_SKIP,
  });

  return {
    text: strings.onboarding.chooseTimezone,
    buttons,
  };
}

/** Parse callback data for target toggle. */
export function parseToggleTargetCallback(data: string): number | null {
  const prefix = `${OnboardingCallbackPrefix.TOGGLE_TARGET}:`;
  if (!data.startsWith(prefix)) return null;
  const index = parseInt(data.slice(prefix.length), 10);
  return Number.isNaN(index) ? null : index;
}

/** Parse callback data for timezone selection. */
export function parseTimezoneCallback(data: string): string | null {
  const prefix = `${OnboardingCallbackPrefix.TIMEZONE}:`;
  if (!data.startsWith(prefix)) return null;
  const zone = data.slice(prefix.length);
  return zone === "skip" ? null : zone;
}

/** Check if we should send a progress update (throttled). */
export function shouldSendProgressUpdate(state: {
  progressUpdateCount: number;
  lastProgressUpdateAt: Date | null;
}): boolean {
  if (state.progressUpdateCount === 0) return true;
  if (state.progressUpdateCount >= MAX_PROGRESS_UPDATES) return true;
  if (state.lastProgressUpdateAt === null) return true;
  return Date.now() - state.lastProgressUpdateAt.getTime() >= PROGRESS_UPDATE_INTERVAL_MS;
}

/** Generate a progress update text based on discovery stage. */
export function generateProgressText(language: "en" | "ru", stage: number): string {
  const strings = stringsFor(language);
  const stages: readonly string[] = [
    strings.onboarding.progressReadingSite,
    strings.onboarding.progressFindingCompetitors,
    strings.onboarding.progressCheckingBlogs,
    strings.onboarding.progressCheckingPrices,
    strings.onboarding.progressAlmostDone,
  ];
  const idx = Math.min(Math.max(0, stage), stages.length - 1);
  // idx is guaranteed to be in bounds [0, stages.length - 1]
  return stages[idx] as string;
}

/** Validate and normalise a URL from user input. */
export function validateUrl(input: string): string | null {
  const trimmed = input.trim();
  const result = normaliseWebsite(trimmed);
  return result ?? null;
}

/** Check if input looks like a URL. */
export function isUrlInput(input: string): boolean {
  const trimmed = input.trim();
  return !/\s/.test(trimmed) && (trimmed.includes(".") || trimmed.startsWith("http"));
}

/** Create the discovery job and return its ID. */
export async function startDiscoveryJob(
  _db: unknown,
  _tenantId: string,
  _input: string,
  _language: "en" | "ru",
): Promise<string> {
  // The actual job is queued by the caller (worker)
  return uuidv7();
}

/** Get the tenant ID for an invitation token. */
export async function getTenantIdFromInvitation(
  db: unknown,
  token: string,
): Promise<string | undefined> {
  const { findUsableInvitation } = await import("@mifluent/domain");
  const invitation = await findUsableInvitation(db as never, token);
  return invitation?.tenantId;
}

/** Check if registration is open. */
export async function isRegistrationOpen(db: unknown): Promise<boolean> {
  const { hasAnyAccount } = await import("@mifluent/domain");
  const { getConfig } = await import("@mifluent/core");
  const config = getConfig();
  const anyAccount = await hasAnyAccount(db as never);
  return !anyAccount || config.REGISTRATION_OPEN;
}
