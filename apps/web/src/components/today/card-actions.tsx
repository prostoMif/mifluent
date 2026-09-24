"use client";

/**
 * The three buttons under a card. Each press is recorded — it is the training
 * signal for the classifier that later replaces the cheap model — and "not
 * following" also pauses the target.
 */

import type { CardAction } from "@mifluent/domain/schemas";
import { useState } from "react";
import { Notice } from "@/components/ui/notice";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import styles from "./today.module.css";

const LABELS: Readonly<Record<CardAction, string>> = {
  not_following_target: "Not following this",
  not_important: "Not important",
  saved: "Save",
};

const CONFIRMATIONS: Readonly<Record<CardAction, string>> = {
  not_following_target: "Paused. You will not get cards about this any more.",
  not_important: "Noted.",
  saved: "Saved.",
};

export function CardActions({ cardId }: { readonly cardId: string }) {
  const [done, setDone] = useState<CardAction | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function act(action: CardAction): Promise<void> {
    setIsPending(true);
    setError(undefined);
    try {
      await sendRequest({ method: "POST", path: `/api/cards/${cardId}/actions`, body: { action } });
      setDone(action);
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    } finally {
      setIsPending(false);
    }
  }

  if (done !== undefined) {
    return <Notice tone="success">{CONFIRMATIONS[done]}</Notice>;
  }

  return (
    <div className={styles["actions"]}>
      {(Object.keys(LABELS) as CardAction[]).map((action) => (
        <button
          className={styles["actionButton"]}
          disabled={isPending}
          key={action}
          onClick={() => {
            void act(action);
          }}
          type="button"
        >
          {LABELS[action]}
        </button>
      ))}
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
    </div>
  );
}
