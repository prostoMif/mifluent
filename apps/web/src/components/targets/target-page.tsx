"use client";

import { useCallback, useEffect, useState } from "react";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import { PriceHistory } from "./price-history";
import { TargetHeader } from "./target-header";
import styles from "./targets.module.css";
import { Timeline } from "./timeline";
import { Vacancies } from "./vacancies";

interface TargetData {
  target: {
    id: string;
    name: string;
    kind: string;
    websiteUrl: string | null;
    reason: string | null;
    pausedAt: Date | null;
    surfaces: string[];
    profileId: string;
  };
  timeline: Array<{
    id: string;
    kind: "event" | "decision";
    occurredAt: string;
    eventKind: string | null;
    summary: string;
    quote: string | null;
    sourceUrl: string | null;
    isUrgent: boolean;
    decisionText: string | null;
    revisitAt: string | null;
  }>;
  hasMore: boolean;
  priceChanges: Array<{
    occurredAt: string;
    kind: "price" | "plan";
    was: string | null;
    became: string;
    quote: string | null;
    sourceUrl: string | null;
  }>;
  vacancies: Array<{
    title: string;
    url: string | null;
    department: string | null;
    location: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    isOpen: boolean;
  }>;
  meta: {
    checkedCount: number;
    daysChecked: number | string;
    historyLimitDays: number;
    isLimited: boolean;
  };
}

interface TargetPageProps {
  readonly targetId: string;
  readonly canEdit: boolean;
}

export function TargetPage({ targetId, canEdit }: TargetPageProps) {
  const [data, setData] = useState<TargetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [filterKind, setFilterKind] = useState<string | null>(null);

  const fetchData = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (filterKind) params.set("eventKind", filterKind);

      try {
        const result = await sendRequest<{
          target: TargetData["target"];
          timeline: TargetData["timeline"];
          hasMore: boolean;
          nextCursor: string | null;
          priceChanges: TargetData["priceChanges"];
          vacancies: TargetData["vacancies"];
          meta: TargetData["meta"];
        }>({
          method: "GET",
          path: `/api/targets/${targetId}?${params.toString()}`,
        });

        if (cursor) {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  timeline: [...prev.timeline, ...result.timeline],
                  hasMore: result.hasMore,
                }
              : result,
          );
        } else {
          setData(result);
        }
      } catch (thrown) {
        setError(toDisplayMessage(thrown));
      } finally {
        if (cursor) {
          setIsLoadingMore(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [targetId, filterKind],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLoadMore = useCallback(async () => {
    if (!data?.hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    // We need to track the cursor separately since it's not in the data anymore
    // For now, we'll use the last entry's occurredAt as cursor
    const lastEntry = data.timeline[data.timeline.length - 1];
    if (lastEntry) {
      await fetchData(lastEntry.occurredAt);
    }
  }, [data?.hasMore, data?.timeline, isLoadingMore, fetchData]);

  const handleFilterChange = useCallback(
    async (kind: string | null) => {
      setFilterKind(kind);
      setIsLoading(true);
      await fetchData();
    },
    [fetchData],
  );

  if (isLoading && !data) {
    return (
      <div className={styles["page"]}>
        <div className={styles["loading"]}>Loading…</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={styles["page"]}>
        <div className={styles["error"]}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { target, timeline, hasMore, priceChanges, vacancies, meta } = data;

  // Check if we only have baseline (single price/plan event with was=null)
  const hasBaselineOnly = priceChanges.length === 1 && priceChanges[0]?.was === null;
  const baselineDate = hasBaselineOnly ? (priceChanges[0]?.occurredAt ?? null) : null;
  const baselineUrl = hasBaselineOnly ? (priceChanges[0]?.sourceUrl ?? null) : null;

  return (
    <div className={styles["page"]}>
      <TargetHeader target={target} canEdit={canEdit} />

      <main className={styles["main"]}>
        <Timeline
          entries={timeline}
          hasMore={hasMore}
          onLoadMore={handleLoadMore}
          isLoading={isLoadingMore}
          filterKind={filterKind}
          onFilterChange={handleFilterChange}
          checkedCount={meta.checkedCount}
          daysChecked={meta.daysChecked}
        />

        <PriceHistory
          changes={priceChanges}
          hasBaselineOnly={hasBaselineOnly}
          baselineDate={baselineDate}
          baselineUrl={baselineUrl}
        />

        <Vacancies vacancies={vacancies} />

        {meta.isLimited && (
          <div className={styles["upgradeNotice"]}>
            <p>
              You are viewing the last {meta.historyLimitDays} days of history.
              <a href="/settings" className={styles["upgradeLink"]}>
                Upgrade to Pro
              </a>
              for full history.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
