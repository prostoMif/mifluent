/**
 * A password box that can be read back.
 *
 * Hiding what is typed protects against somebody standing behind you, which is
 * a real risk in an office and not much of one at a desk at home. The cost is
 * paid every time: a long passphrase typed blind gets mistyped, and the way
 * people avoid mistyping is by choosing something short. So the box is hidden
 * by default and there is a button to show it.
 *
 * The button is deliberately a word rather than an eye icon: an eye means
 * "currently hidden" to half of people and "press to hide" to the other half,
 * and there is no way to tell which half is looking.
 */

"use client";

import { type InputHTMLAttributes, type ReactNode, useId, useState } from "react";
import styles from "./form.module.css";

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "type">;

export interface PasswordFieldProps extends NativeInputProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
}

export function PasswordField({ id, label, hint, error, ...input }: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const statusId = useId();

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

      <div className={styles["passwordRow"]}>
        <input
          {...input}
          className={`${styles["control"]} ${error === undefined ? "" : styles["invalid"]}`}
          id={id}
          type={isVisible ? "text" : "password"}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === "" ? undefined : describedBy}
        />

        <button
          className={styles["reveal"]}
          type="button"
          aria-pressed={isVisible}
          aria-describedby={statusId}
          onClick={() => {
            setIsVisible(!isVisible);
          }}
        >
          {isVisible ? "Hide" : "Show"}
        </button>
      </div>

      {/*
        Announced when it changes, so somebody using a screen reader is told the
        password became visible rather than discovering it later.
      */}
      <span className="visually-hidden" id={statusId} role="status">
        {isVisible ? "Password is visible" : "Password is hidden"}
      </span>

      {error === undefined ? null : (
        <span className={styles["fieldError"]} id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
