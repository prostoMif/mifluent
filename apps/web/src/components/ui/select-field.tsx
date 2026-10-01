"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import formStyles from "./form.module.css";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly error?: string;
  readonly hint?: string;
  readonly id: string;
  readonly name: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, value, onChange, options, error, hint, id, name, className, ...props }, ref) => {
    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      onChange(event.target.value);
    };

    return (
      <div className={formStyles["field"]}>
        <label htmlFor={id} className={formStyles["label"]}>
          {label}
        </label>
        <select
          ref={ref}
          id={id}
          name={name}
          value={value}
          onChange={handleChange}
          className={`${formStyles["input"]} ${error ? formStyles["inputError"] : ""}`}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <p className={formStyles["error"]}>{error}</p>}
        {hint && !error && <p className={formStyles["hint"]}>{hint}</p>}
      </div>
    );
  },
);

SelectField.displayName = "SelectField";
