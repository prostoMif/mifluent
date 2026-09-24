"use client";

/**
 * The first run, as counts rather than a spinner: sources being read, items
 * found, items that passed selection. A number that moves is how a person
 * knows the wait is working.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui/notice";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import styles from "./onboarding.module.css";

interface Progress {
  readonly sources: number;
  readonly sourcesRead: number;
  readonly items: number;
  readonly selected: number;
  readonly hasDigest: boolean;
  readonly job: "waiting" | "running" | "completed" | "failed" | null;
}

export interface FirstRunProgressProps {
  readonly profileId: string;
  readonly runId: string;
  readonly onReady: () => void;
}

const POLL_INTERVAL_MS = 2_000;

export function FirstRunProgress({ profileId, runId, onReady }: FirstRunProgressProps) {
  const [progress, setProgress] = useState<Progress | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // The parent passes a new function on every render; reading it through a
  // ref keeps the polling effect from restarting each time.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let isActive = true;

    const check = async (): Promise<void> => {
      try {
        const next = await sendRequest<Progress>({
          method: "GET",
          path: `/api/watch-profiles/${profileId}/progress?runId=${encodeURIComponent(runId)}`,
        });
        if (!isActive) return;
        setProgress(next);
        if (next.hasDigest && next.job !== "running" && next.job !== "waiting")
          onReadyRef.current();
      } catch (thrown) {
        if (isActive) setError(toDisplayMessage(thrown));
      }
    };

    void check(); // First read at once; the interval handles the rest.
    const timer = setInterval(() => {
      void check(); // A slow answer is superseded by the next tick, not queued behind it.
    }, POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      clearInterval(timer);
    };
  }, [profileId, runId]);

  if (error !== undefined) {
    return <Notice tone="error">{error}</Notice>;
  }

  return (
    <section aria-live="polite" className={styles["stage"]}>
      <h2>Building your first digest</h2>
      {progress?.job === "failed" ? (
        <Notice tone="error">
          The first run stopped. What was collected is kept, and the next scheduled run carries on.{" "}
          <Link href={`/today?profile=${profileId}`}>Go to Today</Link>
        </Notice>
      ) : null}
      <ul className={styles["counters"]}>
        <li>
          Reading sources: {progress?.sourcesRead ?? 0} of {progress?.sources ?? "…"}
        </li>
        <li>Items found: {progress?.items ?? 0}</li>
        <li>Passed selection: {progress?.selected ?? 0}</li>
        <li className={progress?.hasDigest === true ? "" : styles["counterDone"]}>
          {progress?.hasDigest === true ? "Digest ready" : "Digest: not yet"}
        </li>
      </ul>
    </section>
  );
}
