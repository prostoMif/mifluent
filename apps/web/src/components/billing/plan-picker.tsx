"use client";

/**
 * The plans, a term switch (a year by default), and a buy button that sends
 * the person to the payment page. Prices come from the same table the
 * checkout charges, so the page and the payment never disagree.
 */

import {
  type Currency,
  type Discount,
  PAID_PLANS,
  type PaidPlan,
  quote,
  TERMS,
  type TermMonths,
} from "@mifluent/domain/billing/pricing";
import { useCallback, useEffect, useState } from "react";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import styles from "./billing.module.css";

export interface PlanPickerProps {
  readonly language: "en" | "ru";
  readonly currency: Currency;
  readonly isSignedIn: boolean;
  readonly isPaymentEnabled: boolean;
  readonly earlySeatsLeft: number;
  /** A campaign running now: applies to everyone, no code to type. */
  readonly campaign: {
    readonly discount: Discount;
    readonly endsAt: string;
    /** Only on terms this long or longer: a year, for the dated campaigns. */
    readonly minMonths: number;
  } | null;
  /** From a promo link (`/pricing?code=…`). */
  readonly initialCode: string;
}

interface PlanQuote {
  readonly amountMinor: number;
  readonly appliedCode: string | null;
  readonly codeError: string | null;
}

interface QuoteResponse {
  readonly quotes: Readonly<Record<PaidPlan, PlanQuote>>;
  readonly trialEndsAt: string | null;
}

const RU_TERMS: Readonly<Record<number, string>> = {
  1: "1 месяц",
  3: "3 месяца",
  6: "6 месяцев",
  12: "12 месяцев",
};

const TEXT = {
  en: {
    names: { starter: "Starter", pro: "Pro", team: "Team" },
    months: (m: number) => (m === 1 ? "1 month" : `${m} months`),
    perMonth: "/ month",
    termLegend: "Pay for",
    total: (amount: string, m: number) => `${amount} for ${m === 1 ? "a month" : `${m} months`}`,
    early: (left: number) => `Early price for the first 100 Pro accounts — ${left} left`,
    buy: "Choose",
    start: "Start free",
    notYet: "Payments open soon. Everyone gets 14 days of Pro free.",
    campaign: (percent: number, until: string) => `−${percent}% on a year, until ${until}`,
    codeLabel: "Promo code",
    apply: "Apply",
    applied: (code: string) => `Code ${code} applied`,
    trial: (until: string) => `Free Pro until ${until}`,
    features: {
      starter: [
        "7 competitors and platforms",
        "Daily digest",
        "Brand mentions",
        "5 watched pages",
        "1 year of history",
      ],
      pro: [
        "15 competitors and platforms",
        "Daily digest",
        "Changes checked every 6 h",
        "20 watched pages",
        "Full history, monthly report",
      ],
      team: [
        "50 competitors and platforms",
        "Up to 5 businesses or clients",
        "Hourly checks",
        "100 watched pages",
        "Reports for your clients",
      ],
    },
  },
  ru: {
    names: { starter: "Старт", pro: "Pro", team: "Команда" },
    months: (m: number) => RU_TERMS[m] ?? `${m} мес`,
    perMonth: "/ мес",
    termLegend: "Оплатить за",
    total: (amount: string, m: number) =>
      `${amount} за ${m === 1 ? "месяц" : (RU_TERMS[m] ?? `${m} мес`)}`,
    early: (left: number) => `Ранняя цена для первых 100 на Pro — осталось ${left}`,
    buy: "Выбрать",
    start: "Начать бесплатно",
    notYet: "Оплата откроется скоро. Всем — 14 дней Pro бесплатно.",
    campaign: (percent: number, until: string) => `−${percent}% на год до ${until}`,
    codeLabel: "Промокод",
    apply: "Применить",
    applied: (code: string) => `Промокод ${code} применён`,
    trial: (until: string) => `Pro бесплатно до ${until}`,
    features: {
      starter: [
        "7 конкурентов и площадок",
        "Сводка каждый день",
        "Упоминания бренда",
        "5 страниц под наблюдением",
        "История за год",
      ],
      pro: [
        "15 конкурентов и площадок",
        "Сводка каждый день",
        "Проверка изменений каждые 6 ч",
        "20 страниц под наблюдением",
        "Вся история, итоги месяца",
      ],
      team: [
        "50 конкурентов и площадок",
        "До 5 бизнесов или клиентов",
        "Проверка каждый час",
        "100 страниц под наблюдением",
        "Отчёты для клиентов",
      ],
    },
  },
} as const;

export function PlanPicker({
  language,
  currency,
  isSignedIn,
  isPaymentEnabled,
  earlySeatsLeft,
  campaign,
  initialCode,
}: PlanPickerProps) {
  const text = TEXT[language];
  const [months, setMonths] = useState<TermMonths>(12);
  const [pending, setPending] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(initialCode);
  const [sentCode, setSentCode] = useState(initialCode);
  const [server, setServer] = useState<QuoteResponse | null>(null);
  const isEarly = earlySeatsLeft > 0;

  // Signed in, the server's figure is the one charged: it knows the code this
  // account arrived with and whether it holds an early seat.
  const refresh = useCallback(
    async (term: TermMonths, promoCode: string): Promise<void> => {
      if (!isSignedIn) return;
      setError(null);
      try {
        setServer(
          await sendRequest<QuoteResponse>({
            method: "POST",
            path: "/api/billing/quote",
            body: { months: term, currency, promoCode },
          }),
        );
        setSentCode(promoCode);
      } catch (thrown) {
        setError(toDisplayMessage(thrown));
      }
    },
    [currency, isSignedIn],
  );

  // Only the term re-quotes on its own; a newly typed code waits for "Apply".
  useEffect(() => {
    void refresh(months, sentCode);
  }, [months, refresh]);

  function priceOf(plan: PaidPlan): number {
    const fromServer = server?.quotes[plan];
    if (fromServer !== undefined) return fromServer.amountMinor / 100;
    return (
      quote({
        plan,
        months,
        currency,
        isEarlyEligible: isEarly,
        discounts: campaign === null || months < campaign.minMonths ? [] : [campaign.discount],
      }).amountMinor / 100
    );
  }

  const appliedCode = PAID_PLANS.map((plan) => server?.quotes[plan]?.appliedCode).find(
    (applied) => applied != null && applied === sentCode.trim().toUpperCase(),
  );
  const codeError = PAID_PLANS.map((plan) => server?.quotes[plan]?.codeError).find(
    (message) => message != null,
  );

  async function buy(plan: PaidPlan): Promise<void> {
    setPending(plan);
    setError(null);
    const planQuote = server?.quotes[plan];
    const promoCode =
      planQuote !== undefined && planQuote.codeError === null && sentCode.trim() !== ""
        ? sentCode
        : undefined;
    try {
      const { url } = await sendRequest<{ url: string }>({
        method: "POST",
        path: "/api/billing/checkout",
        body: { plan, months, currency, promoCode },
      });
      window.location.assign(url);
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setPending(null);
    }
  }

  const dateFormat = new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <fieldset className={styles["terms"]}>
        <legend className={styles["muted"]}>{text.termLegend}</legend>
        {TERMS.map((term) => (
          <button
            key={term}
            type="button"
            className={`${styles["term"]} ${term === months ? styles["termCurrent"] : ""}`}
            aria-pressed={term === months}
            onClick={() => setMonths(term)}
          >
            {text.months(term)}
          </button>
        ))}
      </fieldset>

      {campaign === null ? null : (
        <Notice tone="success">
          {text.campaign(
            campaign.discount.percentOff,
            dateFormat.format(new Date(campaign.endsAt)),
          )}
        </Notice>
      )}
      {isEarly ? <p className={styles["muted"]}>{text.early(earlySeatsLeft)}</p> : null}
      {isSignedIn ? (
        <form
          className={styles["promo"]}
          onSubmit={(event) => {
            event.preventDefault();
            void refresh(months, code);
          }}
        >
          <label className={styles["muted"]} htmlFor="promo-code">
            {text.codeLabel}
          </label>
          <input
            id="promo-code"
            className={formStyles["control"]}
            value={code}
            maxLength={32}
            autoCapitalize="characters"
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit" className={`${formStyles["button"]} ${formStyles["secondary"]}`}>
            {text.apply}
          </button>
        </form>
      ) : null}
      {appliedCode == null ? null : <p className={styles["muted"]}>{text.applied(appliedCode)}</p>}
      {server?.trialEndsAt == null ? null : (
        <Notice tone="success">
          {text.trial(dateFormat.format(new Date(server.trialEndsAt)))}
        </Notice>
      )}
      {codeError === undefined ? null : <Notice tone="error">{codeError}</Notice>}
      {error === null ? null : <Notice tone="error">{error}</Notice>}
      {isPaymentEnabled ? null : <Notice tone="neutral">{text.notYet}</Notice>}

      <div className={styles["plans"]}>
        {PAID_PLANS.map((plan) => {
          const total = priceOf(plan);
          return (
            <section key={plan} className={styles["plan"]}>
              <h2>{text.names[plan]}</h2>
              <div className={styles["price"]}>
                {formatMoney(total / months, currency)}{" "}
                <span className={styles["muted"]}>{text.perMonth}</span>
              </div>
              <div className={styles["muted"]}>
                {text.total(formatMoney(total, currency), months)}
              </div>
              <ul className={styles["features"]}>
                {text.features[plan].map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {isSignedIn && isPaymentEnabled ? (
                <button
                  type="button"
                  className={formStyles["button"]}
                  disabled={pending !== null}
                  onClick={() => void buy(plan)}
                >
                  {text.buy}
                </button>
              ) : (
                <a className={formStyles["button"]} href="/start">
                  {text.start}
                </a>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function formatMoney(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(currency === "RUB" ? "ru-RU" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "RUB" ? 0 : amount % 1 === 0 ? 0 : 2,
  }).format(currency === "RUB" ? Math.round(amount) : Math.round(amount * 100) / 100);
}
