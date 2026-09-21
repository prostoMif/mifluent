/**
 * Authentication.
 *
 * Better Auth rather than a hand-rolled implementation, and rather than
 * Auth.js. Two reasons, one of them decisive.
 *
 * The decisive one: password hashing, session rotation, reset tokens and
 * account linking are the parts of a codebase where a subtle mistake is both
 * easy to make and invisible until someone else finds it. That is exactly the
 * category of code to take from a library that many people read.
 *
 * The other: as of early 2026 Auth.js is in maintenance — security fixes only,
 * no new features — and Better Auth is where development continues. Starting a
 * new project on the frozen one would mean migrating later for no gain.
 *
 * What is deliberately NOT delegated: multi-tenancy. Better Auth has an
 * organization plugin that would cover tenants, members and invitations, but it
 * brings its own identifier and table conventions, and every domain table in
 * this project already carries a `tenant_id` shaped the way the rest of the
 * schema needs. Sessions and credentials are Better Auth's; tenancy stays ours.
 */

import { getConfig } from "@mifluent/core";
import {
  assertRegistrationAllowed,
  attachUserToInstance,
  findUsableInvitation,
  hasAnyAccount,
  markInvitationAccepted,
  type UsableInvitation,
} from "@mifluent/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getDatabase } from "./db";
import { INVITE_COOKIE_NAME } from "./invitation-cookie";
import { logger } from "./logger";
import { isEmailConfigured, sendEmail } from "./mailer";

const HOUR_IN_SECONDS = 60 * 60;
const DAY_IN_SECONDS = 24 * HOUR_IN_SECONDS;

/**
 * Everything that decides which tables exist and how they behave.
 *
 * Kept separate from the connection details because the Better Auth CLI has to
 * build an instance to work out the schema, and it should read exactly these
 * options rather than a second copy that drifts out of step. See
 * `better-auth.config.ts`.
 */
export const authOptions = {
  emailAndPassword: {
    enabled: true,
    // Minimum length only. Composition rules — one digit, one symbol — push
    // people towards shorter and more predictable passwords, which is the
    // opposite of the intent.
    minPasswordLength: 12,
    maxPasswordLength: 256,
    // Verification needs a working mail sender. Until email delivery exists,
    // requiring it would lock the first user out of their own instance.
    requireEmailVerification: false,
    // A reset is what somebody does after losing control of the account. Not
    // ending the other sessions would leave whoever took it still signed in.
    revokeSessionsOnPasswordReset: true,
  },

  session: {
    expiresIn: 30 * DAY_IN_SECONDS,
    // Sliding expiry: an active session is extended at most once a day, rather
    // than on every request, which would mean a database write per page view.
    updateAge: DAY_IN_SECONDS,
  },

  // Per-scenario limits. A single global rate limit does not protect a login
  // form: the volume that constitutes an attack there is ordinary traffic
  // everywhere else in the application.
  //
  // The keys are Better Auth's own endpoint paths, and a key that matches no
  // endpoint is not an error — it is simply a limit that never applies. Check
  // the paths against the installed version before changing them.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 3600, max: 5 },
      "/request-password-reset": { window: 3600, max: 3 },
      "/reset-password": { window: 3600, max: 5 },
    },
  },
} as const;

/** The one Better Auth endpoint that creates an account. */
const SIGN_UP_PATH = "/sign-up/email";

function createAuth() {
  const config = getConfig();

  return betterAuth({
    ...authOptions,
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDatabase(), { provider: "pg" }),
    trustedOrigins: [config.APP_URL],

    emailAndPassword: {
      ...authOptions.emailAndPassword,
      /*
       * Sending lives here rather than in `authOptions` because it is
       * behaviour, not schema: the generator builds an instance with no
       * mailer and no configuration.
       *
       * An instance without SMTP settings still accepts the request and still
       * answers the same way — see the forgot-password screen. Failing loudly
       * here would tell a stranger which addresses have accounts, because only
       * a real one would reach this line.
       */
      sendResetPassword: async ({ user, url }) => {
        if (!isEmailConfigured()) {
          logger.warn("auth.reset_email_skipped", { reason: "email is not configured" });
          return;
        }

        await sendEmail({
          to: user.email,
          subject: "Reset your Mifluent password",
          text: [
            "Someone asked to reset the password for this Mifluent account.",
            "",
            "Open this link to choose a new one:",
            url,
            "",
            "The link stops working in an hour, and using it signs out every",
            "other device. If this was not you, nothing has changed and you can",
            "ignore this message.",
          ].join("\n"),
        });
      },
    },

    /*
     * Two rules hang off sign-up, and they are attached here rather than in
     * `authOptions` on purpose: `authOptions` is also read by the schema
     * generator, which builds an instance without a database. A hook that
     * queries one would break `db:generate`.
     *
     * Why `hooks.before` and not `databaseHooks.user.create.before`: refusing
     * from the database hook produces a generic failure, and the person in
     * front of a closed instance deserves to be told that it is closed rather
     * than left guessing whether they mistyped their password.
     *
     * // TODO: security review — authentication
     */
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_UP_PATH) {
          return;
        }

        const isTaken = await hasAnyAccount(getDatabase());
        const invitation = await findInvitationFor(
          ctx.getCookie(INVITE_COOKIE_NAME),
          readEmail(ctx.body),
        );

        try {
          assertRegistrationAllowed({
            hasAnyAccount: isTaken,
            isRegistrationOpen: config.REGISTRATION_OPEN,
            hasValidInvitation: invitation !== undefined,
          });
        } catch {
          logger.warn("auth.registration_refused", { reason: "no invitation, sign-up closed" });
          throw new APIError("FORBIDDEN", {
            message: "Sign-up is closed on this instance. Ask whoever runs it for an invitation.",
          });
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          /*
           * Give the new account its organisation and its role.
           *
           * Better Auth runs this *after* its own transaction has committed, so
           * by the time it starts the account, its password and its session are
           * already saved. Letting an error out of here therefore cannot undo
           * any of that — it only turns a working sign-up into an error page
           * with a real account behind it, and the person tries again and is
           * told the address is taken.
           *
           * That is exactly what happened on 18 August, on the first real
           * sign-up this project ever had.
           *
           * So a failure is logged and swallowed. It is recoverable on its own:
           * `resolveMembership` in session.ts notices an account with no
           * membership on the next page load and builds it then. The person
           * sees a working application instead of an error they can do nothing
           * about, and the log still says something went wrong.
           */
          after: async (user, context) => {
            try {
              const invitation = await findInvitationFor(
                context?.getCookie(INVITE_COOKIE_NAME) ?? null,
                user.email,
              );

              const membership = await attachUserToInstance({
                db: getDatabase(),
                userId: user.id,
                tenantName: user.name,
                timezone: config.DEFAULT_TIMEZONE,
                ...(invitation === undefined ? {} : { invitedRole: invitation.role }),
              });

              if (invitation !== undefined) {
                // Marked used only now, so an invitation is not spent by a
                // sign-up that failed for some other reason.
                await markInvitationAccepted(getDatabase(), invitation.id);
              }

              logger.info("tenancy.membership_created", {
                userId: user.id,
                tenantId: membership.tenantId,
                role: membership.role,
                fromInvitation: invitation !== undefined,
              });
            } catch (error) {
              logger.error("tenancy.membership_deferred", { userId: user.id, cause: error });
            }
          },
        },
      },
    },

    advanced: {
      // The digest is read on a phone, from a link in Telegram or email, so the
      // session cookie has to survive a top-level cross-site navigation. "lax"
      // does; "strict" would silently log people out on arrival.
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
      },
    },
  });
}

/**
 * The invitation this request is entitled to use, if any.
 *
 * Both halves have to match: the token proves the person holds the link, and
 * the address proves the link was meant for them. Checking only the token would
 * let one invitation create an account under any address; checking only the
 * address would let anybody who guessed it walk in.
 *
 * // TODO: security review — authentication
 */
async function findInvitationFor(
  token: string | null,
  email: string | undefined,
): Promise<UsableInvitation | undefined> {
  if (token === null || token === "" || email === undefined) {
    return undefined;
  }

  const invitation = await findUsableInvitation(getDatabase(), token);

  if (invitation === undefined) {
    return undefined;
  }

  // Addresses are compared without case, because nobody types their own the
  // same way twice and the mail system does not care either.
  return invitation.email.toLowerCase() === email.trim().toLowerCase() ? invitation : undefined;
}

/** The sign-up body, which arrives as unknown data from outside. */
function readEmail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("email" in body)) {
    return undefined;
  }

  const { email } = body;
  return typeof email === "string" ? email : undefined;
}

let instance: ReturnType<typeof createAuth> | undefined;

/**
 * Built on first use, not at import time: constructing it reads configuration
 * and opens a database pool, and this module gets imported during the Next.js
 * build, on a machine that has neither.
 */
export function getAuth(): ReturnType<typeof createAuth> {
  instance ??= createAuth();
  return instance;
}
