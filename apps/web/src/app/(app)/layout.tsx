/**
 * The shell every signed-in page sits inside.
 *
 * The session is resolved once, here, and the layout refuses before any child
 * renders. That is the point: a page underneath cannot forget to check, because
 * it never gets the chance to run without one.
 *
 * // TODO: security review — authentication
 */

import { getConfig } from "@mifluent/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { MainNav } from "@/components/app/main-nav";
import { ReportProblem } from "@/components/app/report-problem";
import { SignOutButton } from "@/components/app/sign-out-button";
import { getSessionContext } from "@/lib/session";
import packageJson from "../../../package.json";
import styles from "./app.module.css";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getSessionContext();
  const config = getConfig();

  if (session === undefined) {
    redirect("/sign-in");
  }

  return (
    <div className={styles["shell"]}>
      <header className={styles["header"]}>
        <div className={styles["headerInner"]}>
          <Link className={styles["brand"]} href="/today">
            Mifluent
          </Link>

          <MainNav />

          <div className={styles["account"]}>
            <span className={styles["identity"]}>{session.email}</span>
            <span className={styles["roleBadge"]}>{session.role}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className={styles["content"]}>
        {children}

        <footer className={styles["footer"]}>
          <ReportProblem issueTrackerUrl={config.ISSUE_TRACKER_URL} version={packageJson.version} />
        </footer>
      </div>
    </div>
  );
}
