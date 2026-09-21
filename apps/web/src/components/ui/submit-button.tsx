/**
 * A submit button that says what it is doing.
 *
 * The label changes rather than the button disappearing behind a spinner: on a
 * slow connection an unlabelled spinner leaves people unsure whether the form
 * was sent, and they press again.
 */

"use client";

import styles from "./form.module.css";

export interface SubmitButtonProps {
  readonly label: string;
  /** Shown while the request is in flight. */
  readonly pendingLabel: string;
  readonly isPending: boolean;
}

export function SubmitButton({ label, pendingLabel, isPending }: SubmitButtonProps) {
  return (
    <button className={styles["button"]} type="submit" disabled={isPending}>
      {isPending ? pendingLabel : label}
    </button>
  );
}
