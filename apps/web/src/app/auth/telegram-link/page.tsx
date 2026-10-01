import { getConfig } from "@mifluent/core";
import { getPendingOnboarding, pendingIdToStartParam } from "@mifluent/domain";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "@/lib/db";
import { getTranslations } from "@/lib/i18n";
import { PENDING_COOKIE } from "@/lib/pending-cookie";

export const metadata: Metadata = { title: "Open in Telegram" };

export const dynamic = "force-dynamic";

/**
 * The visitor chose Telegram: a button that opens the bot with their sign-up
 * in the start parameter. The bot confirms it and sends the first digest
 * there. Shown only to the browser that started the sign-up.
 */
export default async function TelegramLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const { pending } = await searchParams;
  if (pending === undefined || (await cookies()).get(PENDING_COOKIE)?.value !== pending) {
    redirect("/start");
  }
  const pendingOnboarding = await getPendingOnboarding(getDatabase(), pending);
  if (pendingOnboarding === undefined) redirect("/start");

  const language = pendingOnboarding.language === "ru" ? "ru" : "en";
  const t = getTranslations(language);
  const bot = getConfig().TELEGRAM_BOT_USERNAME;
  const startParam = pendingIdToStartParam(pending);

  if (bot === undefined) {
    return (
      <div className="telegram-link-page">
        <h1>{t.telegramLinkTitle}</h1>
        <p>Telegram is not set up on this instance. Go back and choose email.</p>
        <Link href="/start">{t.telegramLinkBack}</Link>
      </div>
    );
  }

  return (
    <div className="telegram-link-page">
      <header className="telegram-link-header">
        <h1>{t.telegramLinkTitle}</h1>
        <p>{t.telegramLinkSubtitle}</p>
      </header>

      <main className="telegram-link-main">
        <a
          href={`https://t.me/${bot}?start=${startParam}`}
          className="telegram-link-button"
          rel="noopener noreferrer"
        >
          {t.telegramLinkButton}
        </a>

        <p className="telegram-link-hint">
          {language === "ru"
            ? "Если кнопка не сработала, найдите "
            : "If the button does not work, open "}
          <strong>@{bot}</strong>
          {language === "ru" ? " в Telegram и отправьте " : " in Telegram and send "}
          <code>/start {startParam}</code>
        </p>

        <Link href="/start" className="telegram-link-back">
          {t.telegramLinkBack}
        </Link>
      </main>
    </div>
  );
}
