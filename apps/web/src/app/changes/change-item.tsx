import type { PublicChange } from "@mifluent/domain";
import Link from "next/link";
import styles from "./changes.module.css";

const KIND_LABEL: Readonly<Record<"en" | "ru", Readonly<Record<string, string>>>> = {
  en: { price: "Price", plan: "Plan", policy: "Policy", feature: "Feature", news: "News" },
  ru: { price: "Цена", plan: "Тариф", policy: "Правила", feature: "Функция", news: "Новость" },
};

/** One public change: company, kind, date, the fact, the verbatim quote, the source. */
export function ChangeItem({
  change,
  showCompany,
}: {
  readonly change: PublicChange;
  readonly showCompany: boolean;
}) {
  const language = change.language;
  const date = new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(change.occurredAt);
  return (
    <li className={styles["change"]}>
      <div className={styles["meta"]}>
        {showCompany ? <Link href={`/changes/${change.slug}`}>{change.company}</Link> : null}
        {change.kind === null ? null : (
          <span className={styles["kind"]}>{KIND_LABEL[language][change.kind] ?? change.kind}</span>
        )}
        <time dateTime={change.occurredAt.toISOString()}>{date}</time>
      </div>
      <p className={styles["summary"]}>{change.summary}</p>
      {change.quote === null ? null : (
        <blockquote className={styles["quote"]}>{change.quote}</blockquote>
      )}
      {change.sourceUrl === null ? null : (
        <a href={change.sourceUrl} rel="nofollow noopener" target="_blank">
          {language === "ru" ? "Первоисточник" : "Original source"}
        </a>
      )}
    </li>
  );
}
