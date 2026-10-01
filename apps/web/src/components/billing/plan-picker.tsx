"use client";

/**
 * The plans, a term switch (a year by default), and a buy button that sends
 * the person to the payment page. Prices come from the same table the
 * checkout charges, so the page and the payment never disagree.
 */

import {
  type Currency,
  EARLY_PRO_TABLE,
  PAID_PLANS,
  type PaidPlan,
  PRICE_TABLE,
  TERMS,
  type TermMonths,
} from "@mifluent/domain/billing/pricing";
import { useState } from "react";
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
}: PlanPickerProps) {
  const text = TEXT[language];
  const [months, setMonths] = useState<TermMonths>(12);
  const [pending, setPending] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isEarly = earlySeatsLeft > 0;

  async function buy(plan: PaidPlan): Promise<void> {
    setPending(plan);
    setError(null);
    try {
      const { url } = await sendRequest<{ url: string }>({
        method: "POST",
        path: "/api/billing/checkout",
        body: { plan, months, currency },
      });
      window.location.assign(url);
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setPending(null);
    }
  }

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

      {isEarly ? <p className={styles["muted"]}>{text.early(earlySeatsLeft)}</p> : null}
      {error === null ? null : <Notice tone="error">{error}</Notice>}
      {isPaymentEnabled ? null : <Notice tone="neutral">{text.notYet}</Notice>}

      <div className={styles["plans"]}>
        {PAID_PLANS.map((plan) => {
          const total =
            plan === "pro" && isEarly
              ? EARLY_PRO_TABLE[currency][months]
              : PRICE_TABLE[currency][plan][months];
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
