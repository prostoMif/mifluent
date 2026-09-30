"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import { useTranslations } from "@/lib/i18n";

export default function CheckEmailPage() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const t = useTranslations("en"); // TODO: get from pending onboarding

  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState<string | undefined>(undefined);
  const [resendSuccess, setResendSuccess] = useState(false);

  async function handleResend() {
    setIsResending(true);
    setResendError(undefined);
    setResendSuccess(false);

    try {
      await sendRequest({
        method: "POST",
        path: "/api/auth/resend-magic-link",
        body: { email },
      });
      setResendSuccess(true);
    } catch (thrown) {
      setResendError(toDisplayMessage(thrown));
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="check-email-page">
      <header className="check-email-header">
        <h1>{t("checkEmailTitle")}</h1>
        <p>{t("checkEmailSubtitle").replace("{email}", email)}</p>
      </header>

      <main className="check-email-main">
        {resendSuccess && <Notice tone="success">Magic link sent again. Check your inbox.</Notice>}
        {resendError && <Notice tone="error">{resendError}</Notice>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleResend();
          }}
        >
          <div className="check-email-actions">
            <SubmitButton
              isPending={isResending}
              label={t("checkEmailResend")}
              pendingLabel={t("checkEmailResending")}
            />
            <Link href="/start" className="check-email-back">
              {t("checkEmailBack")}
            </Link>
          </div>
        </form>

        <p className="check-email-hint">
          Didn't receive it? Check spam, or try a different email address by going back.
        </p>
      </main>
    </div>
  );
}
