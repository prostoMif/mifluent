/**
 * Anonymous discovery: start a discovery run without an account.
 *
 * Creates a pending_onboardings record, sets a cookie, and starts the discovery job.
 * Rate limited by IP (3/day) and globally (ANON_DISCOVERY_PER_DAY).
 * Uses domain cache (7 days) to avoid repeated model calls.
 *
 * // TODO: security review — accepts a URL that will be fetched (by the worker)
 */

import { getConfig, parseOrThrow } from "@mifluent/core";
import { schema } from "@mifluent/db";
import { QUEUES } from "@mifluent/domain/jobs/queues";
import { hashIp, startAnonDiscovery } from "@mifluent/domain/onboarding/pending";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { PENDING_COOKIE } from "@/lib/pending-cookie";
import { sendInteractiveJob } from "@/lib/queue";

const startSchema = z.object({
  input: z
    .string()
    .trim()
    .min(2, "Enter your site's address or a sentence about the business.")
    .max(2_000),
});

export async function POST(request: Request): Promise<Response> {
  return route({ event: "discovery.started_anon", status: 202 }, async () => {
    assertSameOrigin(request);

    const config = getConfig();
    const body = parseOrThrow(startSchema, await readJsonBody(request));

    // Get client IP for rate limiting
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const ipHash = hashIp(ip);

    // Detect language from Accept-Language header
    const acceptLanguage = request.headers.get("accept-language") ?? "";
    const language = acceptLanguage.toLowerCase().startsWith("ru") ? "ru" : "en";

    // Get timezone from header (set by client) or default
    const timezone = request.headers.get("x-timezone") ?? undefined;

    const db = getDatabase();

    // Start anonymous discovery (checks limits, cache, creates pending_onboardings)
    const { runId, pendingId, jobData } = await startAnonDiscovery(db, {
      input: body.input,
      language,
      timezone,
      ipHash,
    });

    // Send discovery job if not cached
    if (jobData) {
      const actualRunId = await sendInteractiveJob(QUEUES.discoveryRun, jobData.data);
      // Update pending onboarding with actual runId
      await db
        .update(schema.pendingOnboardings)
        .set({ discoveryRunId: actualRunId, updatedAt: new Date() })
        .where(eq(schema.pendingOnboardings.id, pendingId));
    }

    // The cookie binds this sign-up to this browser; every later step
    // checks it (see lib/pending-cookie.ts).
    const pendingCookie = `${PENDING_COOKIE}=${pendingId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.isProduction ? "; Secure" : ""}`;

    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
    headers.set("Set-Cookie", pendingCookie);

    // The same envelope every API answer has, or the browser's client
    // rejects it as malformed — which is what it did.
    return new Response(JSON.stringify({ ok: true, data: { runId, pendingId } }), {
      status: 202,
      headers,
    });
  });
}
