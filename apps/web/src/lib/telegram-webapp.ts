/**
 * Telegram Web App initData verification.
 *
 * The initData string is a URL-encoded query string that Telegram attaches when
 * opening a Mini App. It contains the user's Telegram ID, username, and other
 * fields, plus an HMAC-SHA256 signature that proves it came from Telegram and
 * was not tampered with.
 *
 * Verification follows the official algorithm:
 * 1. Parse the query string into key-value pairs.
 * 2. Remove the `hash` parameter — this is the signature to verify.
 * 3. Sort the remaining pairs by key, join with "\n" into a data-check-string.
 * 4. Derive the secret key: HMAC-SHA256("WebAppData", bot_token).
 * 5. Compute the expected hash: HMAC-SHA256(data_check_string, secret_key).
 * 6. Compare the expected hash with the received `hash` (hex-encoded).
 * 7. Check that `auth_date` is not older than one hour.
 *
 * // TODO: security review — authentication
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, getConfig } from "@mifluent/core";
import { eq } from "drizzle-orm";

export interface TelegramWebAppUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
  readonly is_premium?: boolean;
  readonly allows_write_to_pm?: boolean;
}

export interface TelegramWebAppInitData {
  readonly query_id: string | undefined;
  readonly user: TelegramWebAppUser | undefined;
  readonly receiver: TelegramWebAppUser | undefined;
  readonly chat: TelegramWebAppUser | undefined;
  readonly chat_type: "sender" | "private" | "group" | "supergroup" | "channel" | undefined;
  readonly chat_instance: string | undefined;
  readonly start_param: string | undefined;
  readonly can_send_after: number | undefined;
  readonly auth_date: number;
  readonly hash: string;
}

function parseJsonField<T>(value: string | null, fieldName: string): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new AppError("validation_failed", `Invalid ${fieldName} JSON in initData.`);
  }
}

/** Parse the initData query string into a structured object. */
export function parseInitData(initData: string): TelegramWebAppInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new AppError("validation_failed", "Missing hash in initData.");
  }

  const authDateStr = params.get("auth_date");
  if (!authDateStr) {
    throw new AppError("validation_failed", "Missing auth_date in initData.");
  }
  const auth_date = Number.parseInt(authDateStr, 10);
  if (Number.isNaN(auth_date)) {
    throw new AppError("validation_failed", "Invalid auth_date in initData.");
  }

  const user = parseJsonField<TelegramWebAppUser>(params.get("user"), "user");
  const receiver = parseJsonField<TelegramWebAppUser>(params.get("receiver"), "receiver");
  const chat = parseJsonField<TelegramWebAppUser>(params.get("chat"), "chat");

  const canSendAfterStr = params.get("can_send_after");
  const can_send_after = canSendAfterStr ? Number.parseInt(canSendAfterStr, 10) : undefined;

  return {
    query_id: params.get("query_id") ?? undefined,
    user,
    receiver,
    chat,
    chat_type: params.get("chat_type") as TelegramWebAppInitData["chat_type"] | undefined,
    chat_instance: params.get("chat_instance") ?? undefined,
    start_param: params.get("start_param") ?? undefined,
    can_send_after,
    auth_date,
    hash,
  };
}

/**
 * Verify the initData signature and freshness.
 *
 * Returns the parsed initData on success. Throws AppError on failure:
 * - "unauthorized" with code "invalid_signature" if the HMAC does not match.
 * - "unauthorized" with code "expired" if auth_date is older than 1 hour.
 * - "validation_failed" if the initData is malformed.
 */
export async function verifyInitData(initData: string): Promise<TelegramWebAppInitData> {
  const config = getConfig();
  const botToken = config.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new AppError("configuration_invalid", "Telegram bot token is not configured.");
  }

  const parsed = parseInitData(initData);

  // Check freshness: auth_date must not be older than 1 hour
  const now = Math.floor(Date.now() / 1000);
  const MAX_AGE_SECONDS = 60 * 60;
  if (now - parsed.auth_date > MAX_AGE_SECONDS) {
    throw new AppError("unauthorized", "initData has expired.", { code: "expired" });
  }

  // Build data-check-string: all params except hash, sorted by key, joined with "\n"
  const params = new URLSearchParams(initData);
  params.delete("hash");
  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys.map((key) => `${key}=${params.get(key)}`).join("\n");

  // Derive secret key: HMAC-SHA256("WebAppData", bot_token)
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();

  // Compute expected hash: HMAC-SHA256(data_check_string, secret_key)
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // Compare with received hash using timing-safe comparison
  const receivedHashBuffer = Buffer.from(parsed.hash, "hex");
  const expectedHashBuffer = Buffer.from(expectedHash, "hex");

  if (
    receivedHashBuffer.length !== expectedHashBuffer.length ||
    !timingSafeEqual(receivedHashBuffer, expectedHashBuffer)
  ) {
    throw new AppError("unauthorized", "Invalid initData signature.", {
      code: "invalid_signature",
    });
  }

  return parsed;
}

/**
 * Find or create a user by Telegram user ID and create a session for them.
 *
 * This is called after successful initData verification. It looks up the user
 * by `telegram_user_id` in the database. If found, it creates a Better Auth
 * session and returns the session token. If not found, it throws an error
 * indicating the user must start with the bot first.
 */
export async function createSessionFromTelegramUser(
  telegramUserId: number,
): Promise<{ sessionToken: string; userId: string }> {
  const { getDatabase } = await import("@/lib/db");
  const { getAuth } = await import("@/lib/auth");
  const { schema } = await import("@mifluent/db");

  const db = getDatabase();

  // Find user by telegram_user_id
  const [user] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.telegramUserId, String(telegramUserId)))
    .limit(1);

  if (!user) {
    throw new AppError(
      "unauthorized",
      "No account linked to this Telegram user. Start with the bot first.",
      {
        code: "no_account",
      },
    );
  }

  // Create a session using Better Auth's internal adapter
  const auth = getAuth();
  const authContext = await auth.$context;
  const session = await authContext.internalAdapter.createSession(user.id, false);

  if (!session?.token) {
    throw new AppError("internal_error", "Failed to create session.");
  }

  return { sessionToken: session.token, userId: user.id };
}
