"use client";

import styles from "./targets.module.css";

interface PriceChange {
  readonly occurredAt: string;
  readonly kind: "price" | "plan";
  readonly was: string | null;
  readonly became: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
}

interface PriceHistoryProps {
  readonly changes: readonly PriceChange[];
  readonly hasBaselineOnly: boolean;
  readonly baselineDate: string | null;
  readonly baselineUrl: string | null;
}

const KIND_LABELS = {
  price: "Price",
  plan: "Plan",
} as const;

export function PriceHistory({
  changes,
  hasBaselineOnly,
  baselineDate,
  baselineUrl,
}: PriceHistoryProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  };

  if (hasBaselineOnly && baselineDate) {
    return (
      <section className={styles["priceHistory"]} aria-labelledby="price-heading">
        <h2 id="price-heading" className={styles["sectionTitle"]}>
          Prices and plans
        </h2>
        <p className={styles["baselineOnly"]}>
          Prices recorded on {formatDate(baselineDate)}, no changes since.
          {baselineUrl && (
            <a
              href={baselineUrl}
              rel="noopener noreferrer nofollow"
              target="_blank"
              className={styles["baselineLink"]}
            >
              View snapshot
            </a>
          )}
        </p>
      </section>
    );
  }

  if (changes.length === 0) {
    return (
      <section className={styles["priceHistory"]} aria-labelledby="price-heading">
        <h2 id="price-heading" className={styles["sectionTitle"]}>
          Prices and plans
        </h2>
        <p className={styles["emptyPrice"]}>No price or plan changes recorded.</p>
      </section>
    );
  }

  return (
    <section className={styles["priceHistory"]} aria-labelledby="price-heading">
      <h2 id="price-heading" className={styles["sectionTitle"]}>
        Prices and plans
      </h2>
      <div className={styles["priceTableWrapper"]}>
        <table className={styles["priceTable"]}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Type</th>
              <th scope="col">Was</th>
              <th scope="col">Became</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change, index) => (
              <tr key={`${change.occurredAt}-${index}`}>
                <td>
                  <time dateTime={change.occurredAt}>{formatDate(change.occurredAt)}</time>
                </td>
                <td>
                  <span
                    className={styles["priceKindBadge"]}
                    style={{
                      backgroundColor: change.kind === "price" ? "#eab308" : "#3b82f6",
                    }}
                  >
                    {KIND_LABELS[change.kind]}
                  </span>
                </td>
                <td className={styles["priceWas"]}>
                  {change.was ?? <span className={styles["priceBaseline"]}>— (baseline)</span>}
                </td>
                <td className={styles["priceBecame"]}>{change.became}</td>
                <td>
                  {change.quote && (
                    <details className={styles["quoteDetails"]}>
                      <summary>Quote</summary>
                      <blockquote>«{change.quote}»</blockquote>
                    </details>
                  )}
                  {change.sourceUrl && (
                    <a
                      href={change.sourceUrl}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                      className={styles["sourceLink"]}
                    >
                      Source
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
