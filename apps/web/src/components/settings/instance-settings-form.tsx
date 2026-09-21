"use client";

import { tenantSettingsSchema } from "@mifluent/domain/schemas";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import { type FieldErrors, toFieldErrors } from "@/lib/field-errors";

export interface InstanceSettingsFormProps {
  readonly name: string;
  readonly timezone: string;
}

export function InstanceSettingsForm({ name, timezone }: InstanceSettingsFormProps) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isSaved, setIsSaved] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const parsed = tenantSettingsSchema.safeParse({
      name: form.get("name"),
      timezone: form.get("timezone"),
    });

    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      setFormError(undefined);
      setIsSaved(false);
      return;
    }

    setFieldErrors({});
    setFormError(undefined);
    setIsSaved(false);
    setIsPending(true);

    try {
      await sendRequest({ method: "PATCH", path: "/api/settings", body: parsed.data });
      setIsSaved(true);
      router.refresh();
    } catch (error) {
      setFormError(toDisplayMessage(error));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className={styles["form"]} onSubmit={handleSubmit} noValidate>
      {formError === undefined ? null : <Notice tone="error">{formError}</Notice>}
      {isSaved ? <Notice tone="success">Saved.</Notice> : null}

      <TextField
        id="instance-name"
        name="name"
        label="Business name"
        defaultValue={name}
        hint="Shown in your digest. Nobody outside this instance sees it."
        required
        error={fieldErrors["name"]}
      />

      <TextField
        id="instance-timezone"
        name="timezone"
        label="Time zone"
        defaultValue={timezone}
        hint="An IANA zone name, for example Europe/Berlin. Decides when the morning digest is built."
        required
        error={fieldErrors["timezone"]}
      />

      <div className={styles["actions"]}>
        <SubmitButton isPending={isPending} label="Save settings" pendingLabel="Saving…" />
      </div>
    </form>
  );
}
