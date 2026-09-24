/**
 * Starting discovery: a site or a sentence in, a job id out. The page then
 * polls `/api/discovery/<runId>` while the worker reads the site.
 *
 * // TODO: security review — accepts a URL that will be fetched (by the worker)
 */

import { parseOrThrow } from "@mifluent/core";
import { assertCanRunDiscovery, QUEUES } from "@mifluent/domain";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { sendInteractiveJob } from "@/lib/queue";
import { requireSessionWith } from "@/lib/session";

const startSchema = z.object({
  input: z
    .string()
    .trim()
    .min(2, "Enter your site's address or a sentence about the business.")
    .max(2_000),
  language: z.enum(["en", "ru"]),
});

export async function POST(request: Request): Promise<Response> {
  return route({ event: "discovery.started", status: 202 }, async () => {
    assertSameOrigin(request);

    const session = await requireSessionWith("profile:write");
    const body = parseOrThrow(startSchema, await readJsonBody(request));

    // Checked here for an immediate answer, and again by the job itself.
    await assertCanRunDiscovery(getDatabase(), session.tenantId);

    const runId = await sendInteractiveJob(QUEUES.discoveryRun, {
      tenantId: session.tenantId,
      userId: session.userId,
      ...body,
    });
    return { runId };
  });
}
