import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Notice } from "@/components/ui/notice";
import { isEmailConfigured } from "@/lib/mailer";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Reset your password" };

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  /*
   * Saying "email is not set up here" is safe and saying "no such account" is
   * not. The first is a fact about the instance, visible to anyone who runs
   * it; the second is a fact about a person.
   */
  const canSendEmail = isEmailConfigured();

  return (
    <>
      <h1 className={styles["title"]}>Reset your password</h1>

      {canSendEmail ? (
        <>
          <p className={styles["lead"]}>
            Enter the address you signed up with and we will send you a link.
          </p>
          <ForgotPasswordForm />
        </>
      ) : (
        <Notice tone="neutral">
          This instance has no mail server configured, so it cannot send a reset link. Set the{" "}
          <code>SMTP_*</code> variables and restart, or ask whoever runs the instance to reset the
          password for you.
        </Notice>
      )}

      <div className={styles["footer"]}>
        <p>
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </div>
    </>
  );
}
