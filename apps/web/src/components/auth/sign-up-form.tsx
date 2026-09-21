"use client";

import { MINIMUM_PASSWORD_LENGTH, signUpSchema } from "@mifluent/domain/schemas";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { PasswordField } from "@/components/ui/password-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { authClient } from "@/lib/auth-client";
import { toDisplayMessage } from "@/lib/error-message";
import { type FieldErrors, toFieldErrors } from "@/lib/field-errors";

export interface SignUpFormProps {
  /** True when this account will be the first one, and therefore the owner. */
  readonly isClaimingInstance: boolean;
  /**
   * Set when the person arrived through an invitation. The field is filled in
   * and cannot be changed: the invitation is for one named address, and an
   * editable box would quietly make it for any address.
   */
  readonly invitedEmail?: string | undefined;
}

export function SignUpForm({ isClaimingInstance, invitedEmail }: SignUpFormProps) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const parsed = signUpSchema.safeParse({
      name: form.get("name"),
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

    const { error } = await authClient.signUp.email(parsed.data);

    if (error !== null && error !== undefined) {
      setFormError(toDisplayMessage(error));
      setIsPending(false);

      /*
       * The page was rendered when registration was still open and the server
       * has since refused. Leaving it as it is puts "this account becomes the
       * owner" directly above "registration is closed" — two statements that
       * cannot both be true. Re-rendering replaces the whole screen with
       * whatever is actually the case now.
       */
      if (error.status === 403) {
        router.refresh();
      }

      return;
    }

    // `refresh` and not only `push`: the layout above renders from the session,
    // and without it the new session is not read until the next full load.
    router.push("/today");
    router.refresh();
  }

  return (
    <form className={styles["form"]} onSubmit={handleSubmit} noValidate>
      {formError === undefined ? null : <Notice tone="error">{formError}</Notice>}

      <TextField
        id="name"
        name="name"
        label="Your name"
        autoComplete="name"
        required
        error={fieldErrors["name"]}
      />

      <TextField
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        required
        {...(invitedEmail === undefined ? {} : { defaultValue: invitedEmail, readOnly: true })}
        {...(invitedEmail === undefined
          ? {}
          : { hint: "This is the address the invitation was sent to." })}
        error={fieldErrors["email"]}
      />

      <PasswordField
        id="password"
        name="password"
        label="Password"
        hint={`At least ${MINIMUM_PASSWORD_LENGTH} characters.`}
        autoComplete="new-password"
        required
        error={fieldErrors["password"]}
      />

      <div className={styles["actions"]}>
        <SubmitButton
          isPending={isPending}
          label={isClaimingInstance ? "Create owner account" : "Create account"}
          pendingLabel="Creating…"
        />
      </div>
    </form>
  );
}
