"use client";

/**
 * Waits for the visitor's discovery and moves on to the review screen. Every
 * two seconds; gives up showing "still working" never — discovery has its
 * own time limit and reports a failure when it hits it.
 */

import { useEffect, useState } from "react";
import { Notice } from "@/components/ui/notice";
import { sendRequest } from "@/lib/api-client";

interface Status {
  readonly state: "running" | "completed" | "failed" | "expired";
  readonly error: string | null;
}

export function DiscoveryProgressPoller({
  pendingId,
  failedText,
  retryText,
}: {
  readonly pendingId: string;
  readonly failedText: string;
  readonly retryText: string;
}) {
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const outcome = await readStatus(pendingId);
      if (stopped) return;
      if (outcome.kind === "done") {
        window.location.assign(`/start/review?pending=${encodeURIComponent(pendingId)}`);
      } else if (outcome.kind === "failed") {
        setFailure(outcome.message ?? failedText);
      } else {
        timer = setTimeout(() => void poll(), 2_000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pendingId, failedText]);

  if (failure === null) return null;
  return (
    <Notice tone="error">
      {failure} <a href="/start">{retryText}</a>
    </Notice>
  );
}

type Outcome =
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string | null }
  | { readonly kind: "wait" };

async function readStatus(pendingId: string): Promise<Outcome> {
  try {
    const status = await sendRequest<Status>({
      method: "GET",
      path: `/api/start/status?pending=${encodeURIComponent(pendingId)}`,
    });
    if (status.state === "completed") return { kind: "done" };
    if (status.state === "failed" || status.state === "expired") {
      return { kind: "failed", message: status.error };
    }
  } catch {
    // A dropped request is not a failed discovery: try again a bit later.
  }
  return { kind: "wait" };
}
