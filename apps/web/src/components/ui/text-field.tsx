/**
 * A labelled input.
 *
 * Exists so that the label, the hint and the error message are wired to the
 * input by identifier in one place. Doing it per form is how a field ends up
 * announced to a screen reader as "edit text" and nothing else.
 */

import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./form.module.css";

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">;

export interface TextFieldProps extends NativeInputProps {
  readonly id: string;
  readonly label: string;
  /** Shown under the label, always visible. Not a placeholder. */
  readonly hint?: ReactNode;
  /** Shown under the field and announced when it appears. */
  readonly error?: string | undefined;
}

export function TextField({ id, label, hint, error, ...input }: TextFieldProps) {
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

      <input
        {...input}
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
