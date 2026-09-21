/**
 * A labelled multi-line input. Same wiring as `TextField`, different element.
 */

import type { ReactNode, TextareaHTMLAttributes } from "react";
import styles from "./form.module.css";

type NativeProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">;

export interface TextAreaFieldProps extends NativeProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
}

export function TextAreaField({ id, label, hint, error, ...textarea }: TextAreaFieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter((value) => value !== undefined).join(" ");

  return (
    <div className={styles["field"]}>
      <label className={styles["label"]} htmlFor={id}>
        {label}
      </label>

      {hint === undefined ? null : (
        <span className={styles["hint"]} id={hintId}>
          {hint}
        </span>
      )}

      <textarea
        {...textarea}
        className={`${styles["control"]} ${error === undefined ? "" : styles["invalid"]}`}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === "" ? undefined : describedBy}
      />

      {error === undefined ? null : (
        <span className={styles["fieldError"]} id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
