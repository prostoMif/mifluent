/**
 * Target history API.
 *
 * Returns the combined timeline, price changes, and vacancies for a target.
 * Enforces tenant scoping and plan-based history depth.
 */

import { AppError, isUuid } from "@mifluent/core";
import {
  type EventKind,
  fetchCheckCount,
  fetchPriceChanges,
  fetchTargetHeader,
  fetchTargetTimeline,
  fetchVacancies,
  getHistoryDaysLimit,
  PAGE_SIZE,
} from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ readonly targetId: string }>;
}

async function readTargetId(context: RouteContext): Promise<string> {
  const { targetId } = await context.params;

  if (!isUuid(targetId)) {
    throw new AppError("not_found", "Not found.");
  }

  return targetId;
}

const querySchema = {
  parse: (searchParams: URLSearchParams) => {
    const cursorParam = searchParams.get("cursor");
    const limitParam = searchParams.get("limit");
    return {
      cursor: cursorParam ? new Date(cursorParam) : undefined,
      limit: limitParam ? parseInt(limitParam, 10) : PAGE_SIZE,
      eventKind: searchParams.get("eventKind") || undefined,
    } as const;
  },
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "targets.history_viewed" }, async () => {
    const session = await requireSessionWith("profile:read");
    const targetId = await readTargetId(context);
    const url = new URL(request.url);
    const { cursor, limit, eventKind } = querySchema.parse(url.searchParams);

    const db = getDatabase();

    // Fetch target header (validates ownership via tenant scoping)
    const header = await fetchTargetHeader(db, session.tenantId, targetId);

    if (header === undefined) {
      throw new AppError("not_found", "Not found.");
    }

    // Determine history depth based on plan
    const historyDays = await getHistoryDaysLimit(db, session.tenantId);

    // Fetch all data in parallel
    const timelineOptions: {
      cursor?: Date;
      limit: number;
      eventKindFilter: EventKind | null;
      historyDays?: number;
    } = {
      limit,
      eventKindFilter: eventKind as EventKind | null,
    };
    if (cursor !== undefined) {
      timelineOptions.cursor = cursor;
    }
    if (historyDays !== 3650) {
      timelineOptions.historyDays = historyDays;
    }

    const [timeline, priceChanges, vacancies, checkedCount] = await Promise.all([
      fetchTargetTimeline(db, session.tenantId, targetId, timelineOptions),
      fetchPriceChanges(
        db,
        session.tenantId,
        targetId,
        historyDays === 3650 ? undefined : historyDays,
      ),
      fetchVacancies(db, session.tenantId, targetId),
      fetchCheckCount(db, session.tenantId, targetId, historyDays === 3650 ? 3650 : historyDays),
    ]);

    const daysChecked = historyDays === 3650 ? "all" : historyDays;

    const lastEntry = timeline.entries[timeline.entries.length - 1];
    return {
      target: header,
      timeline: timeline.entries,
      hasMore: timeline.hasMore,
      nextCursor:
        timeline.hasMore && timeline.entries.length > 0 && lastEntry
          ? lastEntry.occurredAt.toISOString()
          : null,
      priceChanges,
      vacancies,
      meta: {
        checkedCount,
        daysChecked,
        historyLimitDays: historyDays,
        isLimited: historyDays < 3650,
      },
    };
  });
}
