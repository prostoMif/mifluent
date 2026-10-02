import styles from "./app.module.css";

/** While a screen's data loads: the shape of a digest, not a spinner. */
export default function Loading() {
  return (
    <div aria-busy="true" role="status">
      <span className={styles["srOnly"]}>Loading…</span>
      <div className={`${styles["skeleton"]} ${styles["skeletonTitle"]}`} />
      <div className={`${styles["skeleton"]} ${styles["skeletonLine"]}`} />
      {[0, 1, 2].map((index) => (
        <div className={`${styles["skeleton"]} ${styles["skeletonCard"]}`} key={index} />
      ))}
    </div>
  );
}
