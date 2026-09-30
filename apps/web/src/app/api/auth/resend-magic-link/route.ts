/**
 * Resend magic link for onboarding.
 */

import { getConfig, parseOrThrow } from "@mifluent/core";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";

const resendSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

export async function POST(request: Request): Promise<Response> {
  return route({ event: "auth.magic_link_resent", status: 200 }, async () => {
    assertSameOrigin(request);

    const body = parseOrThrow(resendSchema, await readJsonBody(request));
    const auth = getAuth();
    const config = getConfig();

    await auth.api.signInMagicLink({
      body: {
        email: body.email,
        callbackURL: `${config.APP_URL}/auth/magic-link/callback`,
      },
      headers: request.headers,
    });

    return { ok: true };
  });
}
