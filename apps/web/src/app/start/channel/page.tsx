import { getPendingOnboarding } from "@mifluent/domain/onboarding/pending";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChannelSelection } from "@/components/onboarding/channel-selection";
import { LanguageSwitcher } from "@/components/onboarding/language-switcher";
import { getDatabase } from "@/lib/db";
import { getTranslations } from "@/lib/i18n";
import { getSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Where to send your digest" };

export const dynamic = "force-dynamic";

export default async function ChannelPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string; lang?: string }>;
}) {
  // Signed-in users go to their digest
  if ((await getSessionContext()) !== undefined) {
    redirect("/today");
  }

  const { pending, lang } = await searchParams;

  if (!pending) {
    redirect("/start");
  }

  const db = getDatabase();
  const pendingOnboarding = await getPendingOnboarding(db, pending);

  if (!pendingOnboarding) {
    // Expired or consumed - redirect to start
    redirect("/start");
  }

  if (!pendingOnboarding.result) {
    // Discovery still running - should not happen here, redirect to review
    redirect(`/start/review?pending=${pending}`);
  }

  // Use language from query param or from pending onboarding
  const language = (lang === "en" || lang === "ru" ? lang : pendingOnboarding.language) as
    | "en"
    | "ru";
  const t = getTranslations(language);

  return (
    <div className="channel-page">
      <header className="channel-header">
        <LanguageSwitcher currentLanguage={language} />
        <h1>{t.whereToSend}</h1>
        <p>{t.chooseChannel}</p>
      </header>
      <main className="channel-main">
        <ChannelSelection pendingId={pending} language={language} />
      </main>
      <footer className="channel-footer">
        <p>
          <a href="/privacy">{t.privacy}</a> · <a href="/terms">{t.terms}</a>
        </p>
      </footer>
    </div>
  );
}
