"use client";

import { signInSchema } from "@mifluent/domain/schemas";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { PasswordField } from "@/components/ui/password-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { authClient } from "@/lib/auth-client";
import { type FieldErrors, toFieldErrors } from "@/lib/field-errors";

/**
 * One message for every way a sign-in can fail.
 *
 * Better Auth already answers identically for "no such account" and "wrong
 * password"; this keeps it that way on screen. Telling somebody that an
 * address is not registered hands them a way to test which of their targets
 * has an account here.
 */
const SIGN_IN_FAILED = "That email and password do not match an account.";

export function SignInForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const parsed = signInSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });

    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      setFormError(undefined);
      return;
    }

    setFieldErrors({});
    setFormError(undefined);
    setIsPending(true);

    const { error } = await authClient.signIn.email(parsed.data);

    if (error !== null && error !== undefined) {
      setFormError(SIGN_IN_FAILED);
      setIsPending(false);
      return;
    }

    router.push("/today");
    router.refresh();
  }

  return (
    <form className={styles["form"]} onSubmit={handleSubmit} noValidate>
      {formError === undefined ? null : <Notice tone="error">{formError}</Notice>}

      <TextField
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        required
        error={fieldErrors["email"]}
      />

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        required
        error={fieldErrors["password"]}
      />

      <div className={styles["actions"]}>
        <SubmitButton isPending={isPending} label="Sign in" pendingLabel="Signing in…" />
      </div>
    </form>
  );
}
