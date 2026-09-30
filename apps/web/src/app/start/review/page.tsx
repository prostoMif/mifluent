import type { DiscoveryResult } from "@mifluent/discovery";
import { getPendingOnboarding } from "@mifluent/domain/onboarding/pending";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DiscoveryReviewAnon } from "@/components/onboarding/discovery-review-anon";
import { LanguageSwitcher } from "@/components/onboarding/language-switcher";
import { getDatabase } from "@/lib/db";
import { getTranslations } from "@/lib/i18n";
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
    return (
      <DiscoveryProgress pendingId={pending} runId={pendingOnboarding.discoveryRunId ?? ""} t={t} />
    );
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
  readonly runId: string;
  readonly t: ReturnType<typeof getTranslations>;
}

function DiscoveryProgress({ pendingId, runId, t }: DiscoveryProgressProps) {
  return (
    <div className="discovery-progress">
      <h2>{t.progressTitle}</h2>
      <p>{t.progressSubtitle}</p>
      <ProgressPoller pendingId={pendingId} runId={runId} />
    </div>
  );
}

function ProgressPoller({ pendingId, runId }: { pendingId: string; runId: string }) {
  // Client-side polling component
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            const pendingId = ${JSON.stringify(pendingId)};
            const runId = ${JSON.stringify(runId)};
            const poll = async () => {
              try {
                const res = await fetch('/api/discovery/' + runId);
                const data = await res.json();
                if (data.state === 'completed') {
                  window.location.href = '/start/review?pending=' + pendingId;
                } else if (data.state === 'failed') {
                  document.body.innerHTML = '<p>Discovery failed: ' + (data.error?.message || 'Unknown error') + '</p><p><a href="/start">Try again</a></p>';
                } else {
                  setTimeout(poll, 2000);
                }
              } catch (e) {
                setTimeout(poll, 5000);
              }
            };
            poll();
          })();
        `,
      }}
    />
  );
}
