import type { Metadata } from "next";
import { EventCard } from "@/components/marketing/event-card";
import { DIGEST_CARDS } from "@/components/marketing/examples";
import styles from "../showcase.module.css";

export const metadata: Metadata = { title: "Showcase", robots: { index: false, follow: false } };

/** 1080×1350: the frame for an Instagram post. Not linked from anywhere. */
export default function ShowcaseCardPage() {
  return (
    <div className={styles["tall"]}>
      <p className={styles["brand"]}>Mifluent · your morning brief</p>
      <div className={styles["stack"]}>
        {DIGEST_CARDS.map((card) => (
          <EventCard key={card.target} {...card} />
        ))}
      </div>
    </div>
  );
}
