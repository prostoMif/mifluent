"use client";

import { useState } from "react";
import styles from "./targets.module.css";

interface TimelineEntry {
  readonly id: string;
  readonly kind: "event" | "decision";
  readonly occurredAt: string;
  readonly eventKind: string | null;
  readonly summary: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
  readonly isUrgent: boolean;
  readonly decisionText: string | null;
  readonly revisitAt: string | null;
}

interface TimelineProps {
  readonly entries: readonly TimelineEntry[];
  readonly hasMore: boolean;
  readonly onLoadMore: () => Promise<void>;
  readonly isLoading: boolean;
  readonly filterKind: string | null;
  readonly onFilterChange: (kind: string | null) => void;
  readonly checkedCount: number;
  readonly daysChecked: number | string;
}

const EVENT_KIND_LABELS: Record<string, string> = {
  price: "Price",
  plan: "Plan",
  feature: "Feature",
  policy: "Policy",
  hiring: "Hiring",
  copy: "Copy",
  incident: "Incident",
  news: "News",
  other: "Other",
};

const EVENT_KIND_COLORS: Record<string, string> = {
  price: "#eab308",
  plan: "#3b82f6",
  feature: "#22c55e",
  policy: "#6366f1",
  hiring: "#f97316",
  copy: "#a855f7",
  incident: "#ef4444",
  news: "#06b6d4",
  other: "#64748b",
};

export function Timeline({
  entries,
  hasMore,
  onLoadMore,
  isLoading,
  filterKind,
  onFilterChange,
  checkedCount,
  daysChecked,
}: TimelineProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  };

  if (entries.length === 0) {
    return (
      <section className={styles["timeline"]} aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className={styles["sectionTitle"]}>
          History
        </h2>
        <p className={styles["emptyTimeline"]}>
          No significant changes for{" "}
          {daysChecked === "all" ? "all time" : `the last ${daysChecked} days`}. Checked{" "}
          {checkedCount} time{checkedCount !== 1 ? "s" : ""}.
        </p>
      </section>
    );
  }

  return (
    <section className={styles["timeline"]} aria-labelledby="timeline-heading">
      <div className={styles["timelineHeader"]}>
        <h2 id="timeline-heading" className={styles["sectionTitle"]}>
          History
        </h2>
        <div className={styles["filter"]}>
          <label htmlFor="kind-filter" className={styles["filterLabel"]}>
            Filter by type
          </label>
          <select
            id="kind-filter"
            className={styles["filterSelect"]}
            value={filterKind ?? ""}
            onChange={(e) => onFilterChange(e.target.value || null)}
          >
            <option value="">All types</option>
            {Object.entries(EVENT_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ol className={styles["timelineList"]}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles["timelineItem"]}>
            <article
              className={`${styles["entry"]} ${entry.kind === "decision" ? styles["entryDecision"] : ""}`}
            >
              <header className={styles["entryHeader"]}>
                <time className={styles["entryDate"]} dateTime={entry.occurredAt}>
                  {formatDate(entry.occurredAt)}
                </time>
                {entry.eventKind && (
                  <span
                    className={styles["entryKindBadge"]}
                    style={{
                      backgroundColor:
                        EVENT_KIND_COLORS[entry.eventKind] ?? EVENT_KIND_COLORS["other"],
                    }}
                  >
                    {EVENT_KIND_LABELS[entry.eventKind] ?? entry.eventKind}
                  </span>
                )}
                {entry.kind === "decision" && (
                  <span className={`${styles["entryKindBadge"]} ${styles["entryKindDecision"]}`}>
                    Decision
                  </span>
                )}
                {entry.isUrgent && (
                  <span className={`${styles["entryKindBadge"]} ${styles["entryKindUrgent"]}`}>
                    Urgent
                  </span>
                )}
              </header>

              <div className={styles["entryContent"]}>
                <p className={styles["entrySummary"]}>{entry.summary}</p>

                {entry.quote && (
                  <blockquote className={styles["entryQuote"]}>«{entry.quote}»</blockquote>
                )}

                {entry.sourceUrl && (
                  <p className={styles["entrySource"]}>
                    <a href={entry.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
                      Source
                    </a>
                  </p>
                )}

                {entry.revisitAt && (
                  <p className={styles["entryRevisit"]}>Revisit by {formatDate(entry.revisitAt)}</p>
                )}
              </div>

              {entry.decisionText && (
                <details
                  className={styles["entryDecisionDetails"]}
                  open={expandedIds.has(entry.id)}
                  onToggle={() => toggleExpand(entry.id)}
                >
                  <summary className={styles["entryDecisionSummary"]}>
                    {expandedIds.has(entry.id) ? "Hide decision" : "Show decision"}
                  </summary>
                  <div className={styles["entryDecisionText"]}>{entry.decisionText}</div>
                </details>
              )}
            </article>
          </li>
        ))}
      </ol>

      {hasMore && (
        <button
          className={styles["loadMore"]}
          onClick={onLoadMore}
          disabled={isLoading}
          type="button"
        >
          {isLoading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
