/**
 * Where a discovery run has got to, and its result once there is one.
 *
 * // TODO: security review — authorisation
 */

import { AppError, isUuid } from "@mifluent/core";
import { discoveryResultSchema } from "@mifluent/discovery";
import { QUEUES } from "@mifluent/domain";
import { z } from "zod";
import { route } from "@/lib/api";
import { readJob } from "@/lib/queue";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly runId: string }>;
}

/** What the worker's discovery job returns. Validated: it crossed a process boundary. */
const outputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed"), result: discoveryResultSchema }),
  z.object({
    status: z.literal("failed"),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "discovery.read" }, async () => {
    const session = await requireSessionWith("profile:write");
    const { runId } = await context.params;

    if (!isUuid(runId)) {
      throw new AppError("not_found", "Not found.");
    }

    const job = await readJob(QUEUES.discoveryRun, runId, session.tenantId);
    if (job.state !== "completed") {
      return { state: job.state === "failed" ? "failed" : "running" };
    }

    const output = outputSchema.safeParse(job.output);
    if (!output.success) {
      throw new AppError("internal_error", "Something went wrong on our side.", {
        reason: "discovery output did not match its schema",
      });
    }

    return output.data.status === "completed"
      ? { state: "completed", result: output.data.result }
      : { state: "failed", error: output.data.error };
  });
}
