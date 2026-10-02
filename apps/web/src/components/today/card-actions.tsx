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

/** The labels in the reader's language; the server component passes them in. */
export interface CardActionLabels {
  readonly buttons: Readonly<Record<CardAction, string>>;
  readonly done: string;
}

const ACTIONS: readonly CardAction[] = [
  "not_following_target",
  "not_important",
  "saved",
  "influenced",
];

export function CardActions({
  cardId,
  labels,
}: {
  readonly cardId: string;
  readonly labels: CardActionLabels;
}) {
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
    return <Notice tone="success">{labels.done}</Notice>;
  }

  return (
    <div className={styles["actions"]}>
      {ACTIONS.map((action) => (
        <button
          className={styles["actionButton"]}
          disabled={isPending}
          key={action}
          onClick={() => {
            void act(action);
          }}
          type="button"
        >
          {labels.buttons[action]}
        </button>
      ))}
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
    </div>
  );
}
