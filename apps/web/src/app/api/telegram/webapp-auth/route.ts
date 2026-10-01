/**
 * Exchange Telegram Web App initData for a session cookie.
 *
 * The Mini App sends the initData (received from Telegram.WebApp.initData)
 * to this endpoint. We verify the signature and freshness, find the user by
 * their Telegram user ID, create a session, and set the session cookie.
 *
 * The cookie must be SameSite=None; Secure because the Mini App runs in a
 * Telegram webview which is a cross-site context.
 *
 * // TODO: security review — authentication
 */

import { createHmac } from "node:crypto";
import { AppError, getConfig } from "@mifluent/core";
import { readJsonBody, route } from "@/lib/api";
import { logger } from "@/lib/logger";
import { createSessionFromTelegramUser, verifyInitData } from "@/lib/telegram-webapp";

interface InitDataRequest {
  readonly initData: string;
}

export async function POST(request: Request): Promise<Response> {
  return route({ event: "telegram.webapp_auth", status: 200 }, async () => {
    const config = getConfig();

    // Telegram Web Apps in a webview need SameSite=None; Secure cookies
    const isProduction = config.isProduction;

    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || !("initData" in body)) {
      throw new AppError("validation_failed", "Missing initData in request body.");
    }

    const { initData } = body as InitDataRequest;
    if (typeof initData !== "string" || initData.trim() === "") {
      throw new AppError("validation_failed", "initData must be a non-empty string.");
    }

    // Verify the initData signature and freshness
    const parsed = await verifyInitData(initData);

    if (!parsed.user) {
      throw new AppError("unauthorized", "initData does not contain user information.", {
        code: "no_user",
      });
    }

    // Create a session for the user
    const { sessionToken, userId } = await createSessionFromTelegramUser(parsed.user.id);

    logger.info("telegram.webapp_auth_success", { userId, telegramUserId: parsed.user.id });

    // Build the response with the session cookie
    const response = new Response(JSON.stringify({ ok: true, redirect: "/today" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });

    // Set the session cookie: SameSite=None; Secure for cross-site webview context
    // The cookie name follows Better Auth's convention: better-auth.session_token
    // With secure prefix in production: __Secure-better-auth.session_token
    const cookiePrefix = isProduction ? "__Secure-" : "";
    const cookieName = `${cookiePrefix}better-auth.session_token`;
    const maxAge = 30 * 24 * 60 * 60; // 30 days, matching Better Auth's session expiry

    // Better Auth only accepts a signed session cookie: the token, a dot, and
    // the base64 HMAC-SHA256 of the token under the auth secret. An unsigned
    // token reads as "no session", which is how the Mini App behaved before.
    const signature = createHmac("sha256", config.BETTER_AUTH_SECRET)
      .update(sessionToken)
      .digest("base64");
    const cookieValue = encodeURIComponent(`${sessionToken}.${signature}`);
    response.headers.append(
      "Set-Cookie",
      `${cookieName}=${cookieValue}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAge}`,
    );

    // Also set the dont_remember token to false (not needed for Mini App, but for consistency)
    const dontRememberName = `${cookiePrefix}better-auth.dont_remember_token`;
    response.headers.append(
      "Set-Cookie",
      `${dontRememberName}=false; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAge}`,
    );

    return response;
  });
}
