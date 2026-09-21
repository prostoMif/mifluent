import type { ReactNode } from "react";
import styles from "./auth.module.css";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={styles["shell"]}>
      <div className={styles["card"]}>
        <p className={styles["brand"]}>Mifluent</p>
        {children}
      </div>
    </div>
  );
}
