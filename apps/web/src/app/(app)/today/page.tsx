import type { Metadata } from "next";
import Link from "next/link";
import styles from "../app.module.css";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <>
      <h1 className={styles["pageTitle"]}>Today</h1>
      <p className={styles["pageLead"]}>What changed around your business since yesterday.</p>

      <section aria-labelledby="empty-heading" className={styles["empty"]}>
        <h2 className={styles["emptyTitle"]} id="empty-heading">
          Nothing to show yet
        </h2>
        <p className={styles["emptyBody"]}>
          Digests start once there is something to watch and the collector has run at least once.
          Neither exists on this instance yet.
        </p>
        <p className={styles["emptyBody"]}>
          Start by describing what you do on the <Link href="/watching">Watching</Link> page.
        </p>
      </section>
    </>
  );
}
