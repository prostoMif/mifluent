"use client";

/**
 * Light / dark switch. The choice is kept in localStorage and applied as
 * data-theme on <html>; until a choice is made the system setting rules.
 * An inline script in the layout applies it before the first paint.
 */

import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "mifluent.theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset["theme"];
    if (current === "light" || current === "dark") setTheme(current);
    else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset["theme"] = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode: the switch still works for this page.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      style={{
        background: "none",
        border: "1px solid var(--colour-border)",
        borderRadius: "999px",
        padding: "0.2rem 0.6rem",
        color: "inherit",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
