import { listWatchProfiles } from "@mifluent/domain";
import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/profiles/profiles.module.css";
import formStyles from "@/components/ui/form.module.css";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../app.module.css";

export const metadata: Metadata = { title: "Watching" };

export const dynamic = "force-dynamic";

export default async function WatchingPage() {
  const session = await requireSessionWith("profile:read");
  const profiles = await listWatchProfiles(getDatabase(), session.tenantId);

  return (
    <>
      <h1 className={appStyles["pageTitle"]}>Watching</h1>
      <p className={appStyles["pageLead"]}>
        What your business is, and what should be watched on its behalf.
      </p>

      {profiles.length === 0 ? (
        <section aria-labelledby="empty-heading" className={appStyles["empty"]}>
          <h2 className={appStyles["emptyTitle"]} id="empty-heading">
            Nothing is being watched yet
          </h2>
          <p className={appStyles["emptyBody"]}>
            A watch profile is a description of your business plus the things worth keeping an eye
            on. Everything else — what gets collected, what reaches your digest — is decided from
            it.
          </p>
          <p className={appStyles["emptyBody"]}>
            Writing the description properly is the part that matters. A vague one produces a vague
            digest.
          </p>
          <Link className={formStyles["button"]} href="/watching/new">
            Create a profile
          </Link>
        </section>
      ) : (
        <>
          <ul className={styles["profileList"]}>
            {profiles.map((profile) => (
              <li className={styles["profileCard"]} key={profile.id}>
                <h2 className={styles["profileName"]}>
                  <Link href={`/watching/${profile.id}`}>{profile.name}</Link>
                </h2>
                <p className={styles["profileMeta"]}>
                  {profile.currentVersion === null
                    ? "No version recorded yet"
                    : `Version ${profile.currentVersion}`}
                  {" · "}
                  Strictness {profile.relevanceThreshold.toFixed(2)}
                </p>
              </li>
            ))}
          </ul>

          <Link
            className={`${formStyles["button"]} ${formStyles["secondary"]}`}
            href="/watching/new"
          >
            Add another profile
          </Link>
        </>
      )}
    </>
  );
}
