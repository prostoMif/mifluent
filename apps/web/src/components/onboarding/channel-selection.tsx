"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import { useTranslations } from "@/lib/i18n";

interface ChannelSelectionProps {
  readonly pendingId: string;
  readonly language: "en" | "ru";
}

export interface ChannelSelectionResult {
  readonly business: {
    readonly name: string;
    readonly description: string;
    readonly niche: string;
    readonly monetization: "free" | "trial" | "subscription" | "one_time" | "unknown";
    readonly platforms: string[];
    readonly countries: string[];
    readonly country: string | undefined;
    readonly extraCountries: string[];
    readonly homeCountry: string | undefined;
    readonly region: string | undefined;
    readonly customerType: string;
    readonly language: "en" | "ru";
  };
  readonly targets: Array<{
    readonly kind: "competitor" | "platform" | "condition";
    readonly name: string;
    readonly websiteUrl: string | null;
    readonly reason: string;
    readonly surfaces: Array<{
      readonly type: "feed" | "diff" | "json" | "query";
      readonly url: string;
      readonly label: string;
      readonly pollIntervalMinutes: number;
      readonly verified: boolean;
    }>;
    readonly newsQuery: string | undefined;
  }>;
  readonly conditions: Array<{
    readonly name: string;
    readonly reason: string;
    readonly surfaces: Array<{
      readonly type: "feed" | "diff" | "json" | "query";
      readonly url: string;
      readonly label: string;
      readonly pollIntervalMinutes: number;
      readonly verified: boolean;
    }>;
    readonly newsQuery: string | undefined;
  }>;
  readonly needsDescription: boolean;
}

export function ChannelSelection({ pendingId, language }: ChannelSelectionProps) {
  const router = useRouter();
  const t = useTranslations(language);
  const [channel, setChannel] = useState<"email" | "telegram" | "">("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const [showEmailField, setShowEmailField] = useState(false);

  async function handleChannelSelect(selectedChannel: "email" | "telegram") {
    setChannel(selectedChannel);
    setShowEmailField(true);
    setError(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!channel) {
      setError(t("selectChannel"));
      return;
    }

    const emailValue = email.trim().toLowerCase();
    if (!emailValue?.includes("@")) {
      setEmailError(t("enterEmail"));
      return;
    }

    setIsPending(true);
    setError(undefined);
    setEmailError(undefined);

    try {
      await sendRequest({
        method: "POST",
        path: "/api/start/channel",
        body: { pendingId, channel, email: emailValue },
      });

      if (channel === "email") {
        // Magic link sent - show check email page
        router.push(`/auth/check-email?email=${encodeURIComponent(emailValue)}`);
      } else {
        // Telegram - show deeplink page
        router.push(
          `/auth/telegram-link?pending=${pendingId}&email=${encodeURIComponent(emailValue)}`,
        );
      }
      router.refresh();
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setIsPending(false);
    }
  }

  return (
    <div className="channel-selection">
      <header className="channel-header">
        <h1>{t("whereToSend")}</h1>
        <p>{t("chooseChannel")}</p>
      </header>

      <main className="channel-main">
        {error && <Notice tone="error">{error}</Notice>}

        <div className="channel-options" role="radiogroup" aria-label={t("channelLabel")}>
          <button
            type="button"
            className={`channel-option ${channel === "email" ? "selected" : ""}`}
            onClick={() => handleChannelSelect("email")}
            aria-pressed={channel === "email"}
          >
            <span className="channel-icon">✉️</span>
            <div className="channel-info">
              <strong>{t("emailChannel")}</strong>
              <span>{t("emailChannelDesc")}</span>
            </div>
          </button>

          <button
            type="button"
            className={`channel-option ${channel === "telegram" ? "selected" : ""}`}
            onClick={() => handleChannelSelect("telegram")}
            aria-pressed={channel === "telegram"}
          >
            <span className="channel-icon">📱</span>
            <div className="channel-info">
              <strong>{t("telegramChannel")}</strong>
              <span>{t("telegramChannelDesc")}</span>
            </div>
          </button>
        </div>

        {showEmailField && (
          <form className="channel-form" onSubmit={handleSubmit}>
            <TextField
              autoComplete="email"
              error={emailError}
              id="channel-email"
              inputMode="email"
              label={t("emailLabel")}
              name="email"
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError(undefined);
              }}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />

            <p className="channel-consent">
              {t("consentPrefix")}
              <Link href="/privacy">{t("privacy")}</Link>
              {t("consentAnd")}
              <Link href="/terms">{t("terms")}</Link>
              {t("consentSuffix")}
            </p>

            <div className="channel-actions">
              <SubmitButton
                isPending={isPending}
                label={channel === "email" ? t("sendMagicLink") : t("continueToTelegram")}
                pendingLabel={channel === "email" ? t("sending") : t("continuing")}
              />
            </div>
          </form>
        )}
      </main>

      <footer className="channel-footer">
        <p>
          <Link href="/privacy">{t("privacy")}</Link> · <Link href="/terms">{t("terms")}</Link>
        </p>
      </footer>
    </div>
  );
}
