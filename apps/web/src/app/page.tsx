import { getConfig } from "@mifluent/core";
import { countEarlySeatsTaken } from "@mifluent/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Landing } from "@/components/marketing/landing";
import { getDatabase } from "@/lib/db";
import { getSignUpAvailability } from "@/lib/registration";
import { getSessionContext } from "@/lib/session";
import styles from "./page.module.css";

/*
 * Class names are read with brackets, not dots, throughout the application.
 * `noPropertyAccessFromIndexSignature` is on, and a CSS module is typed as an
 * index signature, so `styles.page` does not compile. Bracket access is the
 * documented way to satisfy that flag; the alternative was turning the flag off
 * for the whole app to save seven characters per line.
 */

export const dynamic = "force-dynamic";

/** The hosted service's front page is public; a private instance's stays out of search. */
export async function generateMetadata(): Promise<Metadata> {
  if (!getConfig().REGISTRATION_OPEN) return {};
  return {
    title: { absolute: "Mifluent — know when competitors change prices, the next morning" },
    description:
      "Give Mifluent your website. It finds your competitors, platforms and rules, and every morning sends a short brief of what changed — each line quoted from the source.",
    robots: { index: true, follow: true },
    alternates: { canonical: "/" },
  };
}

export default async function HomePage() {
  // Somebody who is signed in came here for their digest, not for a pitch.
  if ((await getSessionContext()) !== undefined) {
    redirect("/today");
  }

  // The hosted service (open sign-up) gets the landing page; a self-hosted
  // instance gets the plain claim / sign-in screen below.
  const config = getConfig();
  if (config.REGISTRATION_OPEN) {
    const taken = await countEarlySeatsTaken(getDatabase());
    return (
      <Landing
        botUsername={config.TELEGRAM_BOT_USERNAME}
        githubStars={await readGithubStars()}
        earlySeatsLeft={Math.max(0, config.EARLY_SEATS - taken)}
        contactEmail={config.FEEDBACK_EMAIL}
      />
    );
  }

  const availability = await getSignUpAvailability();

  return (
    <div className={styles["page"]}>
      <header className={styles["header"]}>
        <h1 className={styles["title"]}>Monitoring that works out what to monitor.</h1>
        <p className={styles["lead"]}>
          Tell Mifluent what your business does. It works out which competitors, which platforms you
          depend on and which rules apply to you — then every morning tells you what changed and
          what that means for you.
        </p>
      </header>

      <section aria-labelledby="start-heading" className={styles["status"]}>
        <h2 id="start-heading" className={styles["statusTitle"]}>
          {availability.isClaimingInstance ? "This instance has no owner yet" : "Sign in"}
        </h2>

        {availability.isClaimingInstance ? (
          <p>
            Nobody has registered here. The first account becomes the owner, and registration closes
            behind it — so claim it before anyone else finds the address.
          </p>
        ) : (
          <p>This instance is already set up. Sign in to see what changed.</p>
        )}

        <p>
          {availability.isOpen ? (
            <Link href="/sign-up">
              {availability.isClaimingInstance ? "Claim this instance" : "Create an account"}
            </Link>
          ) : (
            <Link href="/sign-in">Sign in</Link>
          )}
        </p>
      </section>
    </div>
  );
}

/** The star count, refreshed at most hourly; nothing if GitHub does not answer. */
async function readGithubStars(): Promise<number | null> {
  try {
    const response = await fetch("https://api.github.com/repos/prostoMif/mifluent", {
      next: { revalidate: 3_600 },
      signal: AbortSignal.timeout(2_000),
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "stargazers_count" in body
      ? Number(body.stargazers_count)
      : null;
  } catch {
    return null;
  }
}
