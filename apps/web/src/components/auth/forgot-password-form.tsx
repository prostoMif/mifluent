"use client";

import { emailSchema } from "@mifluent/domain/schemas";
import { type FormEvent, useState } from "react";
import styles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { authClient } from "@/lib/auth-client";

/**
 * The same answer whether or not the address has an account.
 *
 * A form that says "no account with that email" is a free tool for working out
 * who uses this instance. Showing one sentence for every outcome — including a
 * failure at the mail server — costs the person nothing, because there is
 * nothing they could usefully do differently either way.
 */
const NEUTRAL_RESULT = "If that address has an account here, a reset link is on its way to it.";

/** Where the link in the email lands. Better Auth appends the token. */
const RESET_PAGE = "/reset-password";

export function ForgotPasswordForm() {
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [isSent, setIsSent] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const parsed = emailSchema.safeParse(new FormData(event.currentTarget).get("email"));

    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? "Enter an email address.");
      return;
    }

    setEmailError(undefined);
    setIsPending(true);

    // The result is deliberately ignored. Reporting it would undo the point of
    // the single neutral message above.
    await authClient.requestPasswordReset({
      email: parsed.data,
      redirectTo: RESET_PAGE,
    });

    setIsPending(false);
    setIsSent(true);
  }

  if (isSent) {
    return <Notice tone="success">{NEUTRAL_RESULT}</Notice>;
  }

  return (
    <form className={styles["form"]} onSubmit={handleSubmit} noValidate>
      <TextField
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        required
        error={emailError}
      />

      <div className={styles["actions"]}>
        <SubmitButton isPending={isPending} label="Send reset link" pendingLabel="Sending…" />
      </div>
    </form>
  );
}
