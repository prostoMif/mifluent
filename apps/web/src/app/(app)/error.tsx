"use client";

import formStyles from "@/components/ui/form.module.css";
import styles from "./app.module.css";

/** A screen failed to load: say so plainly and offer to try again. */
export default function ScreenError({ reset }: { readonly reset: () => void }) {
  return (
    <section className={styles["empty"]} role="alert">
      <h2 className={styles["emptyTitle"]}>This page did not load</h2>
      <p className={styles["emptyBody"]}>
        Something went wrong on our side. Your data is safe. Не загрузилось — попробуй ещё раз.
      </p>
      <button className={formStyles["button"]} onClick={reset} type="button">
        Try again · Ещё раз
      </button>
    </section>
  );
}
