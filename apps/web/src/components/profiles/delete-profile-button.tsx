"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";

export interface DeleteProfileButtonProps {
  readonly profileId: string;
  readonly profileName: string;
}

export function DeleteProfileButton({ profileId, profileName }: DeleteProfileButtonProps) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleDelete(): Promise<void> {
    setIsPending(true);
    setError(undefined);

    try {
      await sendRequest({ method: "DELETE", path: `/api/watch-profiles/${profileId}` });
      router.push("/watching");
      router.refresh();
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setIsPending(false);
    }
  }

  if (!isConfirming) {
    return (
      <button
        className={`${styles["button"]} ${styles["danger"]}`}
        onClick={() => {
          setIsConfirming(true);
        }}
        type="button"
      >
        Delete this profile
      </button>
    );
  }

  return (
    <div>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}

      {/*
        A second click rather than a browser confirm dialog: the dialog is
        dismissed reflexively, and this one has to say what is about to
        disappear.
      */}
      <Notice tone="neutral">
        Delete <strong>{profileName}</strong>? Digests already sent stay as they are, and nothing
        new will be collected for it.
      </Notice>

      <div className={styles["actions"]}>
        <button
          className={`${styles["button"]} ${styles["danger"]}`}
          disabled={isPending}
          onClick={handleDelete}
          type="button"
        >
          {isPending ? "Deleting…" : "Yes, delete it"}
        </button>
        <button
          className={`${styles["button"]} ${styles["secondary"]}`}
          disabled={isPending}
          onClick={() => {
            setIsConfirming(false);
          }}
          type="button"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
