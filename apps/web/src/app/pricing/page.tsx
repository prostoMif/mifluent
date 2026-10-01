/**
 * Plans and prices. Public: a visitor sees the same prices a signed-in owner
 * pays. Russian visitors see roubles, everyone else dollars; dollars are only
 * chargeable once the payment provider accepts foreign cards.
 */

import { getConfig } from "@mifluent/core";
import { activeCampaigns, countEarlySeatsTaken, normalizeCode } from "@mifluent/domain";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { PlanPicker } from "@/components/billing/plan-picker";
import { getDatabase } from "@/lib/db";
import { getSessionContext } from "@/lib/session";
import styles from "../(app)/app.module.css";

export const metadata: Metadata = { title: "Pricing — Mifluent" };

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<{ readonly code?: string }>;
}

export default async function PricingPage({ searchParams }: PageProps) {
  const config = getConfig();
  const session = await getSessionContext();
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  const language = acceptLanguage.toLowerCase().startsWith("ru") ? "ru" : "en";
  // Roubles for Russian readers, and for everyone while dollar cards are off:
  // a price that cannot be paid is worse than a price in another currency.
  const currency = language === "ru" || !config.PRODAMUS_FOREIGN_CARDS ? "RUB" : "USD";
  const seatsLeft = Math.max(0, config.EARLY_SEATS - (await countEarlySeatsTaken(getDatabase())));
  const [running] = await activeCampaigns(getDatabase(), new Date());
  const campaign =
    running === undefined || running.endsAt === null
      ? null
      : {
          discount: {
            code: running.code,
            kind: "campaign" as const,
            percentOff: running.percentOff,
            months: running.months,
          },
          endsAt: running.endsAt.toISOString(),
          minMonths: running.minMonths ?? 1,
        };
  const initialCode = normalizeCode((await searchParams).code) ?? "";

  return (
    <main className={styles["content"]}>
      <h1 className={styles["pageTitle"]}>{language === "ru" ? "Тарифы" : "Pricing"}</h1>
      <p className={styles["pageLead"]}>
        {language === "ru"
          ? "14 дней Pro бесплатно, без карты. Бесплатный тариф — 3 цели и сводка раз в неделю, навсегда."
          : "14 days of Pro free, no card. The free plan — 3 targets and a weekly digest — is free for good."}
      </p>
      <PlanPicker
        language={language}
        currency={currency}
        isSignedIn={session !== undefined}
        isPaymentEnabled={config.PRODAMUS_URL !== undefined && config.PRODAMUS_SECRET !== undefined}
        earlySeatsLeft={seatsLeft}
        campaign={campaign}
        initialCode={initialCode}
      />
    </main>
  );
}
