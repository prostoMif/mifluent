"use client";

import { MINIMUM_PASSWORD_LENGTH, passwordSchema } from "@mifluent/domain/schemas";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { PasswordField } from "@/components/ui/password-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { authClient } from "@/lib/auth-client";
import { toDisplayMessage } from "@/lib/error-message";

export interface ResetPasswordFormProps {
  /** Taken from the link in the email. Never rendered on screen. */
  readonly token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    const confirmation = form.get("confirmation");

    const parsed = passwordSchema.safeParse(password);

    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message);
      return;
    }

    // Checked in the browser only, on purpose: the second field exists to catch
    // a typo before it locks somebody out, and the server has no use for it.
    if (parsed.data !== confirmation) {
      setPasswordError("The two passwords do not match.");
      return;
    }

    setPasswordError(undefined);
    setFormError(undefined);
    setIsPending(true);

    const { error } = await authClient.resetPassword({ newPassword: parsed.data, token });

    if (error !== null && error !== undefined) {
      setFormError(toDisplayMessage(error));
      setIsPending(false);
      return;
    }

    router.push("/sign-in");
    router.refresh();
  }

  return (
    <form className={styles["form"]} onSubmit={handleSubmit} noValidate>
      {formError === undefined ? null : <Notice tone="error">{formError}</Notice>}

      <PasswordField
        id="password"
        name="password"
        label="New password"
        hint={`At least ${MINIMUM_PASSWORD_LENGTH} characters.`}
        autoComplete="new-password"
        required
        error={passwordError}
      />

      <PasswordField
        id="confirmation"
        name="confirmation"
        label="Repeat the new password"
        autoComplete="new-password"
        required
      />

      <div className={styles["actions"]}>
        <SubmitButton isPending={isPending} label="Set new password" pendingLabel="Saving…" />
      </div>
    </form>
  );
}
