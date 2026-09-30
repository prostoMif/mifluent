"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "@/lib/i18n";

interface LanguageSwitcherProps {
  readonly currentLanguage: "en" | "ru";
}

export function LanguageSwitcher({ currentLanguage }: LanguageSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations(currentLanguage);

  function handleLanguageChange(newLanguage: "en" | "ru") {
    if (newLanguage === currentLanguage) return;

    // Build the new URL with the language parameter
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", newLanguage);

    // Determine the current path
    const path = window.location.pathname;
    const newUrl = `${path}?${params.toString()}`;

    router.push(newUrl);
    router.refresh();
  }

  return (
    <fieldset className="language-switcher" aria-label={t("languageSwitcher")}>
      <legend className="visually-hidden">{t("languageSwitcher")}</legend>
      <button
        type="button"
        className={`lang-btn ${currentLanguage === "en" ? "active" : ""}`}
        onClick={() => handleLanguageChange("en")}
        aria-pressed={currentLanguage === "en"}
      >
        {t("languageEn")}
      </button>
      <button
        type="button"
        className={`lang-btn ${currentLanguage === "ru" ? "active" : ""}`}
        onClick={() => handleLanguageChange("ru")}
        aria-pressed={currentLanguage === "ru"}
      >
        {t("languageRu")}
      </button>
    </fieldset>
  );
}
