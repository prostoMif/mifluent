/**
 * Sending jobs to the worker, and reading their results back.
 *
 * The web process only sends and reads; it never works jobs, runs schedules
 * or maintains pg-boss's tables — the worker owns all of that, and two
 * processes doing maintenance on one queue is how jobs get processed twice.
 *
 * A job's data names its tenant, and every read checks it against the session
 * before returning anything. A job id is not a secret: it travels through the
 * browser, and without the check anyone holding one could read another
 * tenant's discovery result.
 *
 * // TODO: security review — authorisation of job reads
 */

import { AppError, getConfig } from "@mifluent/core";
import { INTERACTIVE_PRIORITY, type QueueName } from "@mifluent/domain/schemas";
import { PgBoss } from "pg-boss";
import { z } from "zod";

let client: Promise<PgBoss> | undefined;

function getClient(): Promise<PgBoss> {
  client ??= (async () => {
    const boss = new PgBoss({
      connectionString: getConfig().DATABASE_URL,
      max: 2,
      schema: "pgboss",
      supervise: false,
      schedule: false,
      migrate: false,
      createSchema: false,
    });
    await boss.start();
    return boss;
  })();
  return client;
}

/** Send a job a person is waiting on; it runs before background work. */
export async function sendInteractiveJob(
  queue: QueueName,
  data: { readonly tenantId: string; readonly [field: string]: unknown },
): Promise<string> {
  const boss = await getClient();
  const id = await boss.send(queue, data, { priority: INTERACTIVE_PRIORITY });

  if (id === null) {
    throw new AppError("conflict", "That is already running. Wait for it to finish.");
  }
  return id;
}

export type JobState = "waiting" | "running" | "completed" | "failed";

export interface JobView {
  readonly state: JobState;
  readonly output: unknown;
}

const tenantDataSchema = z.object({ tenantId: z.string() });

/** A job of this tenant's, or "not found" — the same answer for someone else's. */
export async function readJob(queue: QueueName, jobId: string, tenantId: string): Promise<JobView> {
  const boss = await getClient();
  const job = await boss.getJobById<unknown>(queue, jobId);
  const owner = tenantDataSchema.safeParse(job?.data);

  if (job === null || !owner.success || owner.data.tenantId !== tenantId) {
    throw new AppError("not_found", "Not found.");
  }

  return { state: toState(job.state), output: job.state === "completed" ? job.output : null };
}

function toState(state: string): JobState {
  switch (state) {
    case "created":
    case "retry":
      return "waiting";
    case "active":
      return "running";
    case "completed":
      return "completed";
    default:
      return "failed";
  }
}
