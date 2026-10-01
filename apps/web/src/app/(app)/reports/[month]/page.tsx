import { listWatchProfiles } from "@mifluent/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthlyReportPage } from "@/components/reports/monthly-report-page";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../../app.module.css";

export const metadata: Metadata = { title: "Monthly Report" };

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly month: string }>;
  readonly searchParams: Promise<{ readonly profile?: string }>;
}

export default async function MonthlyReportPageRoute({ params, searchParams }: PageProps) {
  const session = await requireSessionWith("digest:read");
  const db = getDatabase();
  const profiles = await listWatchProfiles(db, session.tenantId);

  if (profiles.length === 0) {
    notFound();
  }

  const { month } = await params;
  const { profile: requested } = await searchParams;
  const profile = profiles.find((candidate) => candidate.id === requested) ?? profiles[0];
  if (profile === undefined) notFound();

  // Validate month format (YYYY-MM)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    notFound();
  }

  const [, monthMonthStr] = month.split("-") as [string, string];
  const monthMonth = parseInt(monthMonthStr, 10);
  if (monthMonth < 1 || monthMonth > 12) {
    notFound();
  }

  // Check if user has Pro access
  const { findTenantPlan } = await import("@mifluent/domain");
  const { limits } = await findTenantPlan(db, session.tenantId);
  const isPro = limits.maxTargets > 3; // Pro has maxTargets: 15, Free: 3

  return (
    <>
      <h1 className={appStyles["pageTitle"]}>Monthly Report</h1>
      <p className={appStyles["pageLead"]}>
        {profile.name} — {formatMonthLabel(month)}
        {profiles.length > 1 && profiles[0] && (
          <>
            {" | "}
            <Link href={`/reports/${month}?profile=${profiles[0].id}`}>Switch profile</Link>
          </>
        )}
      </p>

      {profiles.length > 1 && (
        <nav aria-label="Profiles" className={appStyles["profileSwitch"]}>
          {profiles.map((candidate) => (
            <Link
              aria-current={candidate.id === profile.id ? "page" : undefined}
              href={`/reports/${month}?profile=${candidate.id}`}
              key={candidate.id}
            >
              {candidate.name}
            </Link>
          ))}
        </nav>
      )}

      <MonthlyReportPage
        profileId={profile.id}
        profileName={profile.name}
        month={month}
        isPro={isPro}
      />
    </>
  );
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
