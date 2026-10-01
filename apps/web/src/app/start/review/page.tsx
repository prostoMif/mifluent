import type { DiscoveryResult } from "@mifluent/discovery";
import { getPendingOnboarding } from "@mifluent/domain/onboarding/pending";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DiscoveryProgressPoller } from "@/components/onboarding/discovery-progress-poller";
import { DiscoveryReviewAnon } from "@/components/onboarding/discovery-review-anon";
import { LanguageSwitcher } from "@/components/onboarding/language-switcher";
import { getDatabase } from "@/lib/db";
import { getTranslations } from "@/lib/i18n";
import { PENDING_COOKIE } from "@/lib/pending-cookie";
import { getSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Review discovery" };

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string; lang?: string }>;
}) {
  // Somebody who is signed in came here for their digest
  if ((await getSessionContext()) !== undefined) {
    redirect("/today");
  }

  const { pending, lang } = await searchParams;

  if (!pending) {
    redirect("/start");
  }

  // Only the browser that started this sign-up may see what discovery found.
  if ((await cookies()).get(PENDING_COOKIE)?.value !== pending) {
    redirect("/start");
  }

  const db = getDatabase();
  const pendingOnboarding = await getPendingOnboarding(db, pending);

  if (!pendingOnboarding) {
    // Expired or consumed - redirect to start
    redirect("/start");
  }

  // Use language from query param or from pending onboarding
  const language = (lang === "en" || lang === "ru" ? lang : pendingOnboarding.language) as
    | "en"
    | "ru";
  const t = getTranslations(language);

  if (!pendingOnboarding.result) {
    // Discovery still running - show progress page
    return <DiscoveryProgress pendingId={pending} language={language} t={t} />;
  }

  return (
    <div className="review-page">
      <header className="review-header">
        <LanguageSwitcher currentLanguage={language} />
        <h1>{t.reviewTitle}</h1>
        <p>{t.reviewSubtitle}</p>
      </header>
      <main className="review-main">
        <DiscoveryReviewAnon
          pendingId={pending}
          result={pendingOnboarding.result as DiscoveryResult}
          input={pendingOnboarding.input}
          language={language}
        />
      </main>
    </div>
  );
}

interface DiscoveryProgressProps {
  readonly pendingId: string;
  readonly language: "en" | "ru";
  readonly t: ReturnType<typeof getTranslations>;
}

function DiscoveryProgress({ pendingId, language, t }: DiscoveryProgressProps) {
  return (
    <div className="discovery-progress">
      <h2>{t.progressTitle}</h2>
      <p>{t.progressSubtitle}</p>
      <DiscoveryProgressPoller
        pendingId={pendingId}
        failedText={
          language === "ru" ? "Не получилось прочитать сайт." : "Could not read the site."
        }
        retryText={language === "ru" ? "Попробовать ещё раз" : "Try again"}
      />
    </div>
  );
}
