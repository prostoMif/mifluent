/**
 * Sign-in from the Telegram Mini App, as a Better Auth endpoint:
 * `POST /api/auth/telegram-webapp/sign-in` with `{ initData }`.
 *
 * Why a plugin rather than our own route: the session cookie — its name, the
 * `__Secure-` prefix, the signature format, the cookie cache — belongs to
 * Better Auth and changes with it. An earlier route wrote that cookie by hand
 * and would have stopped signing anyone in, silently, on the first upgrade
 * that changed any of it. `setSessionCookie` is the library's own.
 *
 * The cookie is `SameSite=None`: on Telegram Web the Mini App runs in an
 * iframe on telegram.org, a cross-site context where a Lax cookie is never
 * sent. Only sessions opened here get that attribute.
 *
 * // TODO: security review — authentication
 */

import { AppError, isAppError } from "@mifluent/core";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { logger } from "./logger";
import { verifyInitData } from "./telegram-webapp";

export const TELEGRAM_WEBAPP_SIGN_IN_PATH = "/telegram-webapp/sign-in";

const signInBodySchema = z.object({ initData: z.string().min(1).max(4_096) });

export interface TelegramWebAppOptions {
  /** The account linked to this Telegram user, if there is one. */
  readonly findUserIdByTelegram: (telegramUserId: number) => Promise<string | undefined>;
}

export function telegramWebApp(options: TelegramWebAppOptions): BetterAuthPlugin {
  return {
    id: "telegram-webapp",
    endpoints: {
      telegramWebAppSignIn: createAuthEndpoint(
        TELEGRAM_WEBAPP_SIGN_IN_PATH,
        { method: "POST", body: signInBodySchema },
        async (ctx) => {
          const telegramUserId = await verifiedTelegramUserId(ctx.body.initData);
          const userId = await options.findUserIdByTelegram(telegramUserId);
          if (userId === undefined) {
            throw new APIError("UNAUTHORIZED", {
              message: "No account linked to this Telegram user. Start with the bot first.",
              code: "NO_ACCOUNT",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(userId, false);
          const user = await ctx.context.internalAdapter.findUserById(userId);
          if (session === null || user === null) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not open a session." });
          }
          await setSessionCookie(ctx, { session, user }, false, { sameSite: "none", secure: true });

          logger.info("telegram.webapp_auth_success", { userId });
          return ctx.json({ ok: true, redirect: "/today" });
        },
      ),
    },
  };
}

/** The Telegram user the signed initData speaks for; 401 for anything else. */
async function verifiedTelegramUserId(initData: string): Promise<number> {
  try {
    const parsed = await verifyInitData(initData);
    if (parsed.user === undefined) {
      throw new AppError("unauthorized", "initData does not contain user information.");
    }
    return parsed.user.id;
  } catch (error) {
    if (!isAppError(error) || error.code === "configuration_invalid") throw error;
    throw new APIError("UNAUTHORIZED", { message: error.message });
  }
}
