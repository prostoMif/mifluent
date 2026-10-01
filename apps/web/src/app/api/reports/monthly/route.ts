/**
 * Monthly report API.
 *
 * Returns the full monthly market report for a profile.
 * Enforces tenant scoping and plan-based access (Pro only for full report).
 */

import { AppError, isUuid } from "@mifluent/core";
import { buildMonthlyReport } from "@mifluent/digest";
import { findTenantPlan } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";

interface RouteContext {
  readonly searchParams: Promise<{ readonly profileId?: string; readonly month?: string }>;
}

async function parseParams(context: RouteContext): Promise<{ profileId: string; month: string }> {
  const params = await context.searchParams;
  const profileId = params.profileId;
  const month = params.month;

  if (!profileId || !isUuid(profileId)) {
    throw new AppError("not_found", "Not found.");
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new AppError("not_found", "Not found.");
  }

  const [, monthStr] = month.split("-") as [string, string];
  const monthNum = parseInt(monthStr, 10);
  if (monthNum < 1 || monthNum > 12) {
    throw new AppError("not_found", "Not found.");
  }

  return { profileId, month };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "reports.monthly_viewed" }, async () => {
    const session = await requireSessionWith("digest:read");
    const { profileId, month } = await parseParams(context);

    const db = getDatabase();

    // Verify profile belongs to tenant
    const { findWatchProfile } = await import("@mifluent/domain");
    const profile = await findWatchProfile(db, session.tenantId, profileId);
    if (profile === undefined) {
      throw new AppError("not_found", "Not found.");
    }

    // Check plan - Free gets limited version
    const { limits } = await findTenantPlan(db, session.tenantId);
    const isPro = limits.maxTargets > 3; // Pro has maxTargets: 15, Free: 3

    // Build the report
    const report = await buildMonthlyReport({
      db,
      tenantId: session.tenantId,
      profileId,
      month,
      // LLM not provided here - the report is built without intro for API
      // The intro is generated at build time by the worker job
      dryRun: true,
    });

    // For Free users, limit the data
    const responseData = isPro
      ? report
      : {
          ...report,
          topEvents: report.topEvents.slice(0, 2),
          targetSummaries: report.targetSummaries.slice(0, 5),
          priceChanges: report.priceChanges.slice(0, 5),
          hiringSummaries: report.hiringSummaries.slice(0, 3),
          driftedTargets: report.driftedTargets.slice(0, 3),
          intro: null, // No intro for free
        };

    return responseData;
  });
}
