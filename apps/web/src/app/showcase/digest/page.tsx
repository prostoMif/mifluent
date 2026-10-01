import type { Metadata } from "next";
import { EventCard } from "@/components/marketing/event-card";
import { HERO_CARD } from "@/components/marketing/examples";
import styles from "../showcase.module.css";

export const metadata: Metadata = { title: "Showcase", robots: { index: false, follow: false } };

/** 1200×630: the frame for link previews and the README. Not linked from anywhere. */
export default function ShowcaseDigestPage() {
  return (
    <div className={styles["wide"]}>
      <div>
        <p className={styles["brand"]}>Mifluent</p>
        <h1 className={styles["headline"]}>Know when a competitor changes prices.</h1>
        <p className={styles["sub"]}>The next morning, with the source quoted.</p>
      </div>
      <EventCard {...HERO_CARD} />
    </div>
  );
}
