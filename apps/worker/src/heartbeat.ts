/**
 * A file the worker touches once a minute, for the container healthcheck.
 *
 * "Is the process running" is the wrong question for a worker: a process
 * stuck on a hung socket is running and doing nothing. A file whose age keeps
 * growing is the answer to the right question.
 */

import { writeFile } from "node:fs/promises";
import { logger } from "./runtime.js";

const INTERVAL_MS = 60_000;

export function startHeartbeat(path: string | undefined): () => void {
  if (path === undefined) return () => undefined;

  const beat = async (): Promise<void> => {
    try {
      await writeFile(path, new Date().toISOString());
    } catch (thrown) {
      // Not fatal to the work itself — but the healthcheck will now report
      // the worker unhealthy, and this says why.
      logger.warn("worker.heartbeat_failed", { cause: thrown });
    }
  };

  void beat(); // First beat immediately, so the container is healthy as soon as it starts.
  const timer = setInterval(() => {
    void beat(); // Awaiting inside setInterval would only queue beats behind a slow disk.
  }, INTERVAL_MS);

  return () => {
    clearInterval(timer);
  };
}
