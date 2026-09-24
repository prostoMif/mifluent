import { readDiscoveryAllowance, readTargetAllowance } from "@mifluent/domain";
import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../../app.module.css";

export const metadata: Metadata = { title: "Start watching" };

export const dynamic = "force-dynamic";

export default async function StartWatchingPage() {
  const session = await requireSessionWith("profile:write");
  const db = getDatabase();
  const [discoveries, targets] = await Promise.all([
    readDiscoveryAllowance(db, session.tenantId),
    readTargetAllowance(db, session.tenantId),
  ]);

  return (
    <>
      <h1 className={appStyles["pageTitle"]}>Start watching</h1>
      <p className={appStyles["pageLead"]}>
        One field. Mifluent reads your site, proposes what to keep an eye on, and builds your first
        digest from the last week.
      </p>

      <OnboardingFlow
        discoveriesLeft={discoveries.remaining}
        discoveriesPerMonth={discoveries.limit}
        targetsLeft={targets.remaining}
      />
    </>
  );
}
