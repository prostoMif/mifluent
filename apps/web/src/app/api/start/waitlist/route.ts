/**
 * Waitlist signup when registration is closed.
 *
 * Stores the email in pending_onboardings with channel='waitlist'.
 * No discovery is run — this is just an expression of interest.
 */

import { getConfig, parseOrThrow, uuidv7 } from "@mifluent/core";
import { schema } from "@mifluent/db";
import { hashEmail } from "@mifluent/domain/onboarding/pending";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";

const waitlistSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

export async function POST(request: Request): Promise<Response> {
  return route({ event: "waitlist.signed_up", status: 201 }, async () => {
    assertSameOrigin(request);

    const config = getConfig();
    const body = parseOrThrow(waitlistSchema, await readJsonBody(request));

    // Only allow waitlist when registration is closed
    if (config.REGISTRATION_OPEN) {
      throw new Error("Waitlist is only available when registration is closed");
    }

    const db = getDatabase();
    const emailHash = hashEmail(body.email);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    // Check if this email is already on the waitlist (not consumed, not expired)
    const [existing] = await db
      .select({ id: schema.pendingOnboardings.id })
      .from(schema.pendingOnboardings)
      .where(eq(schema.pendingOnboardings.emailHash, emailHash))
      .limit(1);

    if (existing) {
      // Already on waitlist - return success silently (don't reveal existence)
      return { ok: true };
    }

    // Create waitlist entry
    await db.insert(schema.pendingOnboardings).values({
      id: uuidv7(),
      input: body.email,
      language: "en",
      channel: "waitlist",
      emailHash,
      ipHash: "waitlist", // No IP tracking for waitlist
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true };
  });
}
