/**
 * A message about what just happened to the form above or below it.
 *
 * `role="alert"` on failures and `role="status"` on everything else: a failure
 * interrupts a screen reader, a confirmation waits its turn. Getting this the
 * wrong way round means either shouting over someone or never telling them the
 * form was refused.
 */

import type { ReactNode } from "react";
import styles from "./form.module.css";

export type NoticeTone = "error" | "success" | "neutral";

export interface NoticeProps {
  readonly tone: NoticeTone;
  readonly children: ReactNode;
}

const CLASS_BY_TONE: Readonly<Record<NoticeTone, string>> = {
  error: "noticeError",
  success: "noticeSuccess",
  neutral: "",
};

export function Notice({ tone, children }: NoticeProps) {
  const toneClass = CLASS_BY_TONE[tone];

  return (
    <p
      className={`${styles["notice"]} ${toneClass === "" ? "" : styles[toneClass]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
