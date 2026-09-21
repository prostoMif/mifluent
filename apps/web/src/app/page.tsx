import Link from "next/link";
import { redirect } from "next/navigation";
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

export default async function HomePage() {
  // Somebody who is signed in came here for their digest, not for a pitch.
  if ((await getSessionContext()) !== undefined) {
    redirect("/today");
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
