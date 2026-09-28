/**
 * A file the worker touches once a minute, for the container healthcheck.
 *
 * "Is the process running" is the wrong question for a worker: a process
 * stuck on a hung socket is running and doing nothing. A file whose age keeps
 * growing is the answer to the right question.
 *
 * If HEALTHCHECK_PING_URL is set, a GET request is sent to it every 5 minutes
 * (the heartbeat runs every minute, but we only ping the external URL every 5th
 * beat). This is for external monitoring services like healthchecks.io.
 */

import { writeFile } from "node:fs/promises";
import { getConfig } from "@mifluent/core";
import { logger } from "./runtime.js";

const INTERVAL_MS = 60_000;
const PING_INTERVAL_BEATS = 5; // Every 5 minutes (5 * 60 seconds)

export function startHeartbeat(path: string | undefined): () => void {
  if (path === undefined) return () => undefined;

  const config = getConfig();
  const pingUrl = config.HEALTHCHECK_PING_URL;
  let beatCount = 0;

  const beat = async (): Promise<void> => {
    try {
      await writeFile(path, new Date().toISOString());
    } catch (thrown) {
      // Not fatal to the work itself — but the healthcheck will now report
      // the worker unhealthy, and this says why.
      logger.warn("worker.heartbeat_failed", { cause: thrown });
    }

    // Ping external healthcheck URL every 5th beat (every 5 minutes)
    if (pingUrl !== undefined && beatCount % PING_INTERVAL_BEATS === 0) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        await fetch(pingUrl, { method: "GET", signal: controller.signal });
        clearTimeout(timeout);
      } catch (thrown) {
        // Only log ping failures as debug — they don't affect worker health
        logger.debug("worker.healthcheck_ping_failed", { cause: thrown });
      }
    }

    beatCount += 1;
  };

  void beat(); // First beat immediately, so the container is healthy as soon as it starts.
  const timer = setInterval(() => {
    void beat(); // Awaiting inside setInterval would only queue beats behind a slow disk.
  }, INTERVAL_MS);

  return () => {
    clearInterval(timer);
  };
}
