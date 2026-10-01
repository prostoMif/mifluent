/**
 * The visitor confirmed (and perhaps edited) what discovery proposed. Nothing
 * is created yet — there is no account. The confirmed profile is kept on the
 * pending onboarding and created as it stands when the visitor follows the
 * magic link or opens the bot.
 *
 * // TODO: security review — anonymous onboarding
 */

import { AppError, parseOrThrow } from "@mifluent/core";
import {
  getPendingOnboarding,
  profileFromDiscoverySchema,
  savePendingReview,
} from "@mifluent/domain";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { assertOwnsPending } from "@/lib/pending-cookie";

const reviewSchema = profileFromDiscoverySchema.extend({ pendingId: z.string().uuid() });

export async function POST(request: Request): Promise<Response> {
  return route({ event: "onboarding.reviewed", status: 200 }, async () => {
    assertSameOrigin(request);
    const { pendingId, ...profile } = parseOrThrow(reviewSchema, await readJsonBody(request));
    await assertOwnsPending(pendingId);

    const db = getDatabase();
    const pending = await getPendingOnboarding(db, pendingId);
    if (pending === undefined || pending.result === null) {
      throw new AppError("not_found", "This sign-up has expired. Start again.");
    }

    await savePendingReview(db, pendingId, profile);
    return { pendingId };
  });
}
