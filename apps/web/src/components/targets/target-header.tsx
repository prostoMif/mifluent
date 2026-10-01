"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import styles from "./targets.module.css";

interface TargetHeaderProps {
  readonly target: {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly websiteUrl: string | null;
    readonly reason: string | null;
    readonly pausedAt: Date | null;
    readonly surfaces: readonly string[];
    readonly profileId: string;
  };
  readonly canEdit: boolean;
}

const KIND_LABELS: Record<string, string> = {
  competitor: "Competitor",
  platform: "Platform",
  condition: "Condition",
  self: "Own business",
};

const KIND_ICONS: Record<string, string> = {
  competitor: "🏢",
  platform: "🔧",
  condition: "📋",
  self: "🏠",
};

export function TargetHeader({ target, canEdit }: TargetHeaderProps) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState<"pause" | "remove" | null>(null);

  async function handlePause(): Promise<void> {
    setError(undefined);
    setIsPending("pause");

    try {
      await sendRequest({
        method: "PATCH",
        path: `/api/watch-profiles/${target.profileId}/targets/${target.id}`,
        body: { pausedAt: target.pausedAt ? null : new Date().toISOString() },
      });
      router.refresh();
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    } finally {
      setIsPending(null);
    }
  }

  async function handleRemove(): Promise<void> {
    if (!confirm(`Remove "${target.name}"? This cannot be undone.`)) return;

    setError(undefined);
    setIsPending("remove");

    try {
      await sendRequest({
        method: "DELETE",
        path: `/api/watch-profiles/${target.profileId}/targets/${target.id}`,
      });
      router.push(`/watching/${target.profileId}`);
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    } finally {
      setIsPending(null);
    }
  }

  const isPaused = target.pausedAt !== null;

  return (
    <header className={styles["targetHeader"]}>
      <div className={styles["headerMain"]}>
        <div className={styles["identity"]}>
          <span className={styles["kindIcon"]} aria-hidden="true">
            {KIND_ICONS[target.kind] ?? "🏷️"}
          </span>
          <div>
            <h1 className={styles["targetName"]}>{target.name}</h1>
            <p className={styles["targetKind"]}>
              {KIND_LABELS[target.kind] ?? target.kind}
              {target.websiteUrl && (
                <>
                  {" · "}
                  <a
                    href={target.websiteUrl}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className={styles["websiteLink"]}
                  >
                    {new URL(target.websiteUrl).hostname}
                  </a>
                </>
              )}
            </p>
          </div>
        </div>

        <div className={styles["statusBadges"]}>
          <span
            className={`${styles["badge"]} ${isPaused ? styles["badgePaused"] : styles["badgeActive"]}`}
          >
            {isPaused ? "Paused" : "Active"}
          </span>
          {target.surfaces.length > 0 && (
            <span className={styles["badge"]}>
              {target.surfaces
                .map((s) => (s === "diff" ? "Page diff" : s.toUpperCase()))
                .join(", ")}
            </span>
          )}
        </div>
      </div>

      {target.reason && <p className={styles["reason"]}>{target.reason}</p>}

      {canEdit && (
        <div className={styles["actions"]}>
          <button
            className={`${styles["button"]} ${isPaused ? styles["buttonPrimary"] : ""}`}
            onClick={handlePause}
            disabled={isPending === "pause"}
            type="button"
          >
            {isPending === "pause" ? "…" : isPaused ? "Resume" : "Pause"}
          </button>
          <button
            className={`${styles["button"]} ${styles["buttonDanger"]}`}
            onClick={handleRemove}
            disabled={isPending === "remove"}
            type="button"
          >
            {isPending === "remove" ? "…" : "Remove"}
          </button>
        </div>
      )}

      {error && <p className={styles["error"]}>{error}</p>}
    </header>
  );
}
