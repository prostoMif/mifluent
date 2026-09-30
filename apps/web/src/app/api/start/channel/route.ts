/**
 * Channel selection: user chooses email or Telegram and provides email.
 *
 * Updates pending_onboardings with channel and email hash.
 * For email: sends magic link via Better Auth.
 * For Telegram: stores email, returns deeplink info.
 */

import { getConfig, parseOrThrow } from "@mifluent/core";
import { schema } from "@mifluent/db";
import { hashEmail, updatePendingChannel } from "@mifluent/domain/onboarding/pending";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";

const channelSchema = z.object({
  pendingId: z.string().uuid(),
  channel: z.enum(["email", "telegram"]),
  email: z.string().trim().email("Enter a valid email address."),
});

export async function POST(request: Request): Promise<Response> {
  return route({ event: "onboarding.channel_selected", status: 200 }, async () => {
    assertSameOrigin(request);

    const body = parseOrThrow(channelSchema, await readJsonBody(request));
    const db = getDatabase();

    // Verify pending onboarding exists and is valid
    const [pending] = await db
      .select()
      .from(schema.pendingOnboardings)
      .where(eq(schema.pendingOnboardings.id, body.pendingId))
      .limit(1);

    if (!pending) {
      throw new Error("Pending onboarding not found or expired");
    }

    if (pending.consumedAt) {
      throw new Error("This onboarding has already been completed");
    }

    if (pending.expiresAt < new Date()) {
      throw new Error("This onboarding has expired");
    }

    if (!pending.result) {
      throw new Error("Discovery not yet completed");
    }

    const emailHash = hashEmail(body.email);

    // Update pending onboarding with channel and email
    await updatePendingChannel(db, body.pendingId, {
      channel: body.channel,
      emailHash,
    });

    if (body.channel === "email") {
      // Send magic link via Better Auth
      const auth = getAuth();
      const config = getConfig();

      await auth.api.signInMagicLink({
        body: {
          email: body.email,
          callbackURL: `${config.APP_URL}/auth/magic-link/callback?pending=${body.pendingId}`,
        },
        headers: request.headers,
      });

      return { ok: true, channel: "email" };
    } else {
      // Telegram channel - email stored for account identity
      // The deeplink will be generated on the client side
      return { ok: true, channel: "telegram" };
    }
  });
}
