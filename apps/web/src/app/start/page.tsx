import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LanguageSwitcher } from "@/components/onboarding/language-switcher";
import { StartForm } from "@/components/onboarding/start-form";
import { getTranslations } from "@/lib/i18n";
import { getSignUpAvailability } from "@/lib/registration";
import { getSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Start monitoring" };

export const dynamic = "force-dynamic";

export default async function StartPage() {
  // Somebody who is signed in came here for their digest, not for a pitch.
  if ((await getSessionContext()) !== undefined) {
    redirect("/today");
  }

  const availability = await getSignUpAvailability();

  // Detect language from Accept-Language header
  const headersList = await headers();
  const acceptLanguage = headersList.get("accept-language") ?? "";
  const language = acceptLanguage.toLowerCase().startsWith("ru") ? "ru" : "en";
  const t = getTranslations(language);

  // If registration is closed and no valid invitation, show waitlist page
  if (!availability.isOpen) {
    return <WaitlistPage t={t} language={language} />;
  }

  return (
    <div className="start-page">
      <header className="start-header">
        <LanguageSwitcher currentLanguage={language} />
        <h1>{t.startTitle}</h1>
        <p>{t.startSubtitle}</p>
      </header>

      <main className="start-main">
        <StartForm
          isClaimingInstance={availability.isClaimingInstance}
          invitedEmail={availability.invitedEmail}
          language={language}
        />
      </main>

      <footer className="start-footer">
        <p>
          <a href="/privacy">{t.privacy}</a> · <a href="/terms">{t.terms}</a>
        </p>
      </footer>
    </div>
  );
}

interface WaitlistPageProps {
  readonly t: ReturnType<typeof getTranslations>;
  readonly language: "en" | "ru";
}

function WaitlistPage({ t, language }: WaitlistPageProps) {
  return (
    <div className="start-page">
      <header className="start-header">
        <LanguageSwitcher currentLanguage={language} />
        <h1>{t.waitlistTitle}</h1>
        <p>{t.waitlistSubtitle}</p>
      </header>

      <main className="start-main">
        <WaitlistForm t={t} />
      </main>

      <footer className="start-footer">
        <p>
          <a href="/privacy">{t.privacy}</a> · <a href="/terms">{t.terms}</a>
        </p>
      </footer>
    </div>
  );
}

interface WaitlistFormProps {
  readonly t: ReturnType<typeof getTranslations>;
}

function WaitlistForm({ t }: WaitlistFormProps) {
  return (
    <form className="start-form" action="/api/start/waitlist" method="POST">
      <label htmlFor="email">{t.waitlistEmailLabel}</label>
      <input
        type="email"
        id="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        placeholder={t.waitlistEmailPlaceholder}
      />
      <button type="submit">{t.waitlistButton}</button>
    </form>
  );
}
