/**
 * The event card: the one object the product is about. A target, what kind
 * of change, the fact, the verbatim quote, why it matters, the source and
 * how old the change is. Four looks — a price (old struck through, new
 * beside it), a rule (with the date it takes effect), a feature, and a
 * mention of the reader's own brand.
 *
 * Pure markup with no data access, so the landing page, the showcase pages
 * and later /today and the Mini App can all render it.
 */

import styles from "./event-card.module.css";

export type EventCardKind = "price" | "rule" | "feature" | "mention";

export interface EventCardProps {
  readonly kind: EventCardKind;
  readonly target: string;
  readonly fact: string;
  readonly quote?: string | undefined;
  readonly why?: string | undefined;
  readonly source: { readonly label: string; readonly url: string };
  readonly age: string;
  /** For a price: the old and the new figure. */
  readonly was?: string | undefined;
  readonly became?: string | undefined;
  /** For a rule: when it takes effect. */
  readonly effective?: string | undefined;
  /** Show the action buttons (decorative on the landing page). */
  readonly showActions?: boolean | undefined;
}

const BADGE: Readonly<Record<EventCardKind, string>> = {
  price: "Price",
  rule: "Rule",
  feature: "Feature",
  mention: "Mention",
};

export function EventCard(props: EventCardProps) {
  return (
    <article className={`${styles["card"]} ${styles[props.kind]}`}>
      <header className={styles["head"]}>
        <span className={styles["target"]}>{props.target}</span>
        <span className={styles["badge"]}>{BADGE[props.kind]}</span>
      </header>

      {props.was !== undefined && props.became !== undefined ? (
        <p className={styles["change"]}>
          <s className={styles["was"]}>{props.was}</s>
          <span aria-hidden="true" className={styles["arrow"]}>
            →
          </span>
          <span className={styles["became"]}>{props.became}</span>
        </p>
      ) : null}

      <p className={styles["fact"]}>{props.fact}</p>

      {props.effective === undefined ? null : (
        <p className={styles["effective"]}>Takes effect {props.effective}</p>
      )}

      {props.quote === undefined ? null : (
        <blockquote className={styles["quote"]}>{props.quote}</blockquote>
      )}

      {props.why === undefined ? null : (
        <p className={styles["why"]}>
          <strong>Why it matters:</strong> {props.why}
        </p>
      )}

      <footer className={styles["foot"]}>
        <a href={props.source.url} rel="nofollow noopener" target="_blank">
          {props.source.label}
        </a>
        <span>{props.age}</span>
      </footer>

      {props.showActions === true ? (
        <div className={styles["actions"]} aria-hidden="true">
          <span>Not important</span>
          <span>Save</span>
          <span>Changed a decision</span>
        </div>
      ) : null}
    </article>
  );
}
