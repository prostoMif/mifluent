"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import styles from "./monthly-report.module.css";

interface MonthlyReportData {
  month: string;
  profileName: string;
  language: "en" | "ru";
  isPro: boolean;
  topEvents: Array<{
    id: string;
    targetName: string | null;
    kind: string | null;
    summary: string;
    sourceUrl: string | null;
    occurredAt: string;
    facts: Array<{ statement: string; quote: string }>;
  }>;
  targetSummaries: Array<{
    targetId: string;
    targetName: string;
    targetKind: string;
    oneLiner: string;
    isQuiet: boolean;
  }>;
  priceChanges: Array<{
    targetId: string;
    targetName: string;
    kind: "price" | "plan";
    was: string | null;
    became: string;
    sourceUrl: string | null;
    occurredAt: string;
  }>;
  hiringSummaries: Array<{
    targetId: string;
    targetName: string;
    openCount: number;
    newThisMonth: number;
    departments: string[];
  }>;
  decisionsCount: number;
  driftedTargets: Array<{
    targetId: string;
    targetName: string;
    targetKind: string;
    daysSinceActivity: number;
  }>;
  intro: Array<{ text: string; eventIds: string[] }> | null;
  sourcesChecked: number;
  itemsConsidered: number;
}

interface MonthlyReportPageProps {
  profileId: string;
  profileName: string;
  month: string;
  isPro: boolean;
}

export function MonthlyReportPage({
  profileId,
  profileName,
  month,
  isPro,
}: MonthlyReportPageProps) {
  const [data, setData] = useState<MonthlyReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const fetchData = useCallback(async () => {
    try {
      const result = await sendRequest<MonthlyReportData>({
        method: "GET",
        path: `/api/reports/monthly?profileId=${profileId}&month=${month}`,
      });
      setData(result);
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    } finally {
      setIsLoading(false);
    }
  }, [profileId, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className={styles["page"]}>
        <div className={styles["loading"]}>Loading monthly report…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles["page"]}>
        <div className={styles["error"]}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const strings = getStrings(data.language);

  return (
    <div className={styles["page"]}>
      <header className={styles["header"]}>
        <h1 className={styles["title"]}>
          {isPro
            ? strings.monthly.title(profileName, formatMonthLabel(month))
            : strings.monthly.shortTitle(profileName, formatMonthLabel(month))}
        </h1>
        {!isPro && <p className={styles["proNotice"]}>{strings.monthly.proOnly}</p>}
        <p className={styles["meta"]}>
          {strings.monthly.sourcesChecked(data.sourcesChecked, data.itemsConsidered)}
        </p>
      </header>

      {data.intro !== null && data.intro.length > 0 && (
        <section className={styles["section"]}>
          <h2 className={styles["sectionTitle"]}>{strings.monthly.introLabel}</h2>
          <div className={styles["intro"]}>
            {data.intro.map((sentence, i) => (
              <p key={i}>{sentence.text}</p>
            ))}
          </div>
        </section>
      )}

      {data.topEvents.length > 0 && (
        <section className={styles["section"]}>
          <h2 className={styles["sectionTitle"]}>{strings.monthly.topEvents}</h2>
          <div className={styles["topEvents"]}>
            {data.topEvents.map((event) => (
              <article key={event.id} className={styles["topEvent"]}>
                <header className={styles["topEventHeader"]}>
                  <span className={styles["topEventTarget"]}>{event.targetName ?? "General"}</span>
                  <span className={styles["topEventKind"]}>{event.kind ?? "other"}</span>
                  <time className={styles["topEventDate"]} dateTime={event.occurredAt}>
                    {formatDate(event.occurredAt, data.language)}
                  </time>
                </header>
                <p className={styles["topEventSummary"]}>{event.summary}</p>
                {event.facts.length > 0 && (
                  <details className={styles["topEventFacts"]}>
                    <summary>{strings.monthly.topEvents} — facts</summary>
                    <ul>
                      {event.facts.map((fact, i) => (
                        <li key={i}>
                          <strong>{fact.statement}</strong>
                          <q>{fact.quote}</q>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {event.sourceUrl && (
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className={styles["sourceLink"]}
                  >
                    {strings.source}
                  </a>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {data.targetSummaries.length > 0 && (
        <section className={styles["section"]}>
          <h2 className={styles["sectionTitle"]}>{strings.monthly.perTarget}</h2>
          <table className={styles["table"]}>
            <thead>
              <tr>
                <th>{strings.monthly.perTarget}</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {data.targetSummaries.map((target) => (
                <tr key={target.targetId} className={target.isQuiet ? styles["quietRow"] : ""}>
                  <td>
                    <Link href={`/targets/${target.targetId}`} className={styles["targetLink"]}>
                      {target.targetName}
                    </Link>
                    <span className={styles["targetKind"]}> ({target.targetKind})</span>
                  </td>
                  <td>{target.oneLiner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.priceChanges.length > 0 && (
        <section className={styles["section"]}>
          <h2 className={styles["sectionTitle"]}>{strings.monthly.priceChanges}</h2>
          <table className={styles["table"]}>
            <thead>
              <tr>
                <th>Target</th>
                <th>Kind</th>
                <th>Was</th>
                <th>Became</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.priceChanges.map((change, i) => (
                <tr key={i}>
                  <td>
                    <Link href={`/targets/${change.targetId}`} className={styles["targetLink"]}>
                      {change.targetName}
                    </Link>
                  </td>
                  <td>{change.kind}</td>
                  <td>{change.was ?? "—"}</td>
                  <td>{change.became}</td>
                  <td>
                    <time dateTime={change.occurredAt}>
                      {formatDate(change.occurredAt, data.language)}
                    </time>
                    {change.sourceUrl && (
                      <a
                        href={change.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className={styles["sourceLink"]}
                      >
                        {strings.source}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.hiringSummaries.length > 0 && (
        <section className={styles["section"]}>
          <h2 className={styles["sectionTitle"]}>{strings.monthly.hiring}</h2>
          <table className={styles["table"]}>
            <thead>
              <tr>
                <th>Target</th>
                <th>Open</th>
                <th>New</th>
                <th>Departments</th>
              </tr>
            </thead>
            <tbody>
              {data.hiringSummaries.map((hiring, i) => (
                <tr key={i}>
                  <td>
                    <Link href={`/targets/${hiring.targetId}`} className={styles["targetLink"]}>
                      {hiring.targetName}
                    </Link>
                  </td>
                  <td>{hiring.openCount}</td>
                  <td>{hiring.newThisMonth}</td>
                  <td>{hiring.departments.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.decisionsCount > 0 && (
        <section className={styles["section"]}>
          <h2 className={styles["sectionTitle"]}>{strings.monthly.decisions}</h2>
          <p>{strings.monthly.decisionCount(data.decisionsCount)}</p>
          <p className={styles["decisionsNote"]}>
            Decision texts are not shown here — they are private to you.
          </p>
        </section>
      )}

      {data.driftedTargets.length > 0 && (
        <section className={styles["section"]}>
          <h2 className={styles["sectionTitle"]}>{strings.monthly.drift}</h2>
          <ul className={styles["driftList"]}>
            {data.driftedTargets.map((drift) => (
              <li key={drift.targetId}>
                <Link href={`/targets/${drift.targetId}`} className={styles["targetLink"]}>
                  {drift.targetName}
                </Link>
                <span className={styles["driftMeta"]}>
                  {strings.monthly.driftedTarget(drift.targetName, drift.daysSinceActivity)} (
                  {drift.targetKind})
                </span>
              </li>
            ))}
          </ul>
          <p className={styles["driftNote"]}>
            These targets have had no events and no reactions from you for 60+ days. Consider
            removing them to keep your profile focused.
          </p>
        </section>
      )}

      {data.topEvents.length === 0 &&
        data.targetSummaries.length === 0 &&
        data.priceChanges.length === 0 &&
        data.hiringSummaries.length === 0 &&
        data.decisionsCount === 0 &&
        data.driftedTargets.length === 0 && (
          <section className={styles["section"]}>
            <p>{strings.monthly.noEvents}</p>
            <p className={styles["meta"]}>
              {strings.monthly.sourcesChecked(data.sourcesChecked, data.itemsConsidered)}
            </p>
          </section>
        )}
    </div>
  );
}

function getStrings(language: "en" | "ru") {
  const en = {
    monthly: {
      title: (profile: string, month: string) => `${profile} — Monthly Report: ${month}`,
      shortTitle: (profile: string, month: string) => `${profile} — ${month} summary`,
      proOnly: "Full monthly report is a Pro feature.",
      topEvents: "Top events of the month",
      perTarget: "Per target",
      priceChanges: "Price & plan changes",
      hiring: "Hiring activity",
      decisions: "Your decisions",
      drift: "Targets to review (60+ days quiet)",
      noEvents: "No significant events this month.",
      quiet: "quiet",
      eventsCount: (count: number) => `${count} event${count === 1 ? "" : "s"}`,
      priceChangeRow: (target: string, kind: string, was: string | null, became: string) =>
        `${target} (${kind}): ${was ?? "—"} → ${became}`,
      hiringRow: (target: string, open: number, newCount: number) =>
        `${target}: ${open} open${newCount > 0 ? `, ${newCount} new` : ""}`,
      decisionCount: (count: number) => `${count} decision${count === 1 ? "" : "s"} recorded`,
      driftedTarget: (target: string, days: number) => `${target} — no activity for ${days} days`,
      sourcesChecked: (sources: number, items: number) =>
        `Checked ${sources} sources, ${items} items.`,
      introLabel: "Summary",
    },
    source: "source",
  };

  const ru = {
    monthly: {
      title: (profile: string, month: string) => `${profile} — Ежемесячный отчёт: ${month}`,
      shortTitle: (profile: string, month: string) => `${profile} — итоги ${month}`,
      proOnly: "Полный ежемесячный отчёт — в Pro.",
      topEvents: "Главные события месяца",
      perTarget: "По целям",
      priceChanges: "Изменения цен и планов",
      hiring: "Найм",
      decisions: "Твои решения",
      drift: "Цели без активности 60+ дней — убрать?",
      noEvents: "За месяц значимых событий не было.",
      quiet: "тихо",
      eventsCount: (count: number) => `${count} событи${count === 1 ? "е" : count < 5 ? "я" : "й"}`,
      priceChangeRow: (target: string, kind: string, was: string | null, became: string) =>
        `${target} (${kind}): ${was ?? "—"} → ${became}`,
      hiringRow: (target: string, open: number, newCount: number) =>
        `${target}: ${open} открыт${open === 1 ? "а" : open < 5 ? "ы" : ""}${newCount > 0 ? `, ${newCount} новых` : ""}`,
      decisionCount: (count: number) =>
        `Зафиксировано ${count} решени${count === 1 ? "е" : count < 5 ? "я" : "й"}`,
      driftedTarget: (target: string, days: number) => `${target} — без активности ${days} дн.`,
      sourcesChecked: (sources: number, items: number) =>
        `Проверено ${sources} источников, ${items} материалов.`,
      introLabel: "Суть",
    },
    source: "источник",
  };

  return language === "ru" ? ru : en;
}

function formatMonthLabel(month: string): string {
  const [yearStr, monthStr] = month.split("-") as [string, string];
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDate(isoString: string, language: "en" | "ru"): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}
