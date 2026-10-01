import { can, findWatchProfile, findWatchTarget } from "@mifluent/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TargetPage } from "@/components/targets/target-page";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../../app.module.css";

export const metadata: Metadata = { title: "Target" };

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly targetId: string }>;
}

export default async function TargetPageRoute({ params }: PageProps) {
  const session = await requireSessionWith("profile:read");
  const { targetId } = await params;

  const db = getDatabase();

  // Find the target and verify ownership via tenant scoping
  const target = await findWatchTarget(db, session.tenantId, targetId);

  if (target === undefined) {
    notFound();
  }

  // Also fetch the profile to check permissions
  const profile = await findWatchProfile(db, session.tenantId, target.profileId);

  if (profile === undefined) {
    notFound();
  }

  const canEdit = can(session.role, "profile:write");

  return (
    <>
      <h1 className={appStyles["pageTitle"]}>{target.name}</h1>
      <p className={appStyles["pageLead"]}>
        History of changes, prices, and vacancies for this target.
      </p>
      <TargetPage targetId={targetId} canEdit={canEdit} />
    </>
  );
}
