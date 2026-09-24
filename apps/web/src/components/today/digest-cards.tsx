/**
 * A built digest, as the web shows it — the same cards Telegram gets.
 *
 * Everything shown came from someone else's page or from a model; React
 * escapes it, and links are rendered only from addresses the digest builder
 * already checked, with `rel="noopener noreferrer nofollow"` (docs/security.md).
 */

import type { DigestBlockView, DigestView } from "@mifluent/digest";
import { CardActions } from "./card-actions";
import styles from "./today.module.css";

const NOTICE_TEXT = {
  baseline_recorded:
    "Prices, changelogs and job boards are now recorded; changes will show up from the next check.",
  cost_cap_reached:
    "Processing is paused until tomorrow — this instance reached its daily budget. You can add your own model key in settings.",
} as const;

const REJECTION_TEXT: Readonly<Record<string, string>> = {
  below_cosine: "too far from what you watch",
  model_rejected: "judged not relevant",
  no_verified_quote: "no quote could be verified",
};

export interface DigestCardsProps {
  readonly digest: DigestView;
  readonly canAct: boolean;
}

export function DigestCards({ digest, canAct }: DigestCardsProps) {
  return (
    <section aria-label={digest.isUrgent ? "Urgent" : "Digest"}>
      <header className={styles["digestHeader"]}>
        <p className={styles["period"]}>
          {digest.isUrgent ? "Urgent · " : ""}
          {formatPeriod(digest)}
        </p>
      </header>

      {digest.notices.map((notice) => (
        <p
          className={styles["notice"]}
          key={notice.code === "target_quiet" ? notice.targetName : notice.code}
        >
          {notice.code === "target_quiet"
            ? `${notice.targetName} has been quieter than usual.`
            : NOTICE_TEXT[notice.code]}
        </p>
      ))}

      {digest.cards.length === 0 ? (
        <EmptyDigest digest={digest} />
      ) : (
        <ol className={styles["cards"]}>
          {digest.cards.map((card) => (
            <li
              className={`${styles["card"]} ${card.isUrgent ? styles["cardUrgent"] : ""}`}
              key={card.id}
            >
              <h2 className={styles["headline"]}>
                {card.kind === "group"
                  ? `${card.headline}: ${card.blocks.length + card.moreCount} changes`
                  : card.headline}{" "}
                {card.ageDays === null ? null : (
                  <span className={styles["age"]}>({formatAge(card.ageDays)})</span>
                )}
              </h2>
              {card.blocks.map((block, index) => (
                <Block block={block} key={`${card.id}-${index}`} />
              ))}
              {card.moreCount > 0 ? (
                <p className={styles["period"]}>and {card.moreCount} more</p>
              ) : null}
              {canAct ? <CardActions cardId={card.id} /> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Block({ block }: { readonly block: DigestBlockView }) {
  switch (block.kind) {
    case "fact":
      return (
        <p className={styles["fact"]}>
          {block.content}{" "}
          {block.sourceUrl === null ? null : (
            <a href={block.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
              source
            </a>
          )}
          {block.quote === null ? null : <q className={styles["quote"]}>{block.quote}</q>}
        </p>
      );
    case "implication":
      return (
        <p className={styles["implication"]}>
          <strong>Why it matters:</strong> {block.content}
        </p>
      );
    case "model_interpretation":
      return (
        <p className={styles["interpretation"]}>
          <strong>Model's interpretation ⚠</strong> {block.content}
        </p>
      );
    case "analyst_opinion":
      return <p className={styles["implication"]}>{block.content}</p>;
  }
}

function EmptyDigest({ digest }: { readonly digest: DigestView }) {
  return (
    <div className={styles["misses"]}>
      <p>
        Nothing that concerns you in this period. Checked {digest.sourcesChecked} sources,{" "}
        {digest.itemsConsidered} items.
      </p>
      {digest.nearMisses.length === 0 ? null : (
        <>
          <p>Closest:</p>
          <ul>
            {digest.nearMisses.map((miss) => (
              <li key={`${miss.title}-${miss.reason}`}>
                {miss.url === null ? (
                  miss.title || "—"
                ) : (
                  <a href={miss.url} rel="noopener noreferrer nofollow" target="_blank">
                    {miss.title || "—"}
                  </a>
                )}{" "}
                — rejected: {REJECTION_TEXT[miss.reason] ?? miss.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function formatAge(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function formatPeriod(digest: DigestView): string {
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const from = format.format(digest.periodStart);
  const to = format.format(digest.periodEnd);
  return from === to ? to : `${from} — ${to}`;
}
