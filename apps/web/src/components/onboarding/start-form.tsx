"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import { useTranslations } from "@/lib/i18n";
import styles from "./start-form.module.css";

export interface StartFormProps {
  readonly isClaimingInstance: boolean;
  readonly invitedEmail?: string | undefined;
  readonly language: "en" | "ru";
}

export function StartForm({
  isClaimingInstance,
  invitedEmail: _invitedEmail,
  language,
}: StartFormProps) {
  const router = useRouter();
  const t = useTranslations(language);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = String(form.get("input") ?? "").trim();

    if (!input) {
      setError(t("startInputHint")); // Reuse hint as error message
      return;
    }

    setIsPending(true);
    setError(undefined);

    try {
      const { runId: _runId, pendingId } = await sendRequest<{ runId: string; pendingId: string }>({
        method: "POST",
        path: "/api/start/discovery",
        body: { input },
      });

      // Redirect to review page with pending ID
      router.push(`/start/review?pending=${pendingId}`);
      router.refresh();
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setIsPending(false);
    }
  }

  return (
    <form className={styles["form"]} noValidate onSubmit={handleSubmit}>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}

      <TextField
        autoComplete="url"
        hint={t("startInputHint")}
        id="start-input"
        label={t("startInputLabel")}
        name="input"
        required
      />

      <p className={styles["hint"]}>{t("startHint")}</p>

      <div className={styles["actions"]}>
        <SubmitButton
          isPending={isPending}
          label={t("startButton")}
          pendingLabel={t("startButtonPending")}
        />
      </div>

      {isClaimingInstance && <p className={styles["claimHint"]}>{t("startClaimHint")}</p>}
    </form>
  );
}
