"use client";

/**
 * Telegram Mini App entry point.
 *
 * Loads the Telegram WebApp SDK, exchanges initData for a session cookie,
 * and redirects to the main app. If the user has no account, shows a screen
 * telling them to start with the bot first.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./tg.module.css";

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
  themeParams: Record<string, string>;
  ready: () => void;
  expand: () => void;
  close: () => void;
  MainButton: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  onEvent: (event: string, callback: () => void) => void;
  offEvent: (event: string, callback: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

type AuthState = "loading" | "authenticating" | "no_account" | "error";

function isDarkColor(hex: string): boolean {
  const color = hex.replace("#", "");
  const r = Number.parseInt(color.slice(0, 2), 16);
  const g = Number.parseInt(color.slice(2, 4), 16);
  const b = Number.parseInt(color.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

function applyTelegramTheme(webApp: TelegramWebApp): void {
  if (!webApp.themeParams) return;
  const params = webApp.themeParams;
  const root = document.documentElement;
  Object.entries(params).forEach(([key, value]) => {
    const cssKey = key.replace(/([A-Z])/g, "-$1").toLowerCase();
    root.style.setProperty(`--tg-${cssKey}`, value);
  });
  const bgColor = params["bg_color"];
  if (bgColor) {
    const isDark = isDarkColor(bgColor);
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
}

async function authenticateWithServer(
  webApp: TelegramWebApp,
  router: ReturnType<typeof useRouter>,
  setState: React.Dispatch<React.SetStateAction<AuthState>>,
  setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>,
): Promise<void> {
  setState("authenticating");
  try {
    const response = await fetch("/api/telegram/webapp-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: webApp.initData }),
      credentials: "include",
    });

    const data = await response.json();

    if (response.ok && data.ok) {
      router.push(data.redirect || "/today");
      router.refresh();
    } else if (response.status === 401 && data.error?.details?.code === "no_account") {
      setState("no_account");
    } else {
      setErrorMessage(data.error?.message || "Authentication failed. Please try again.");
      setState("error");
    }
  } catch {
    setErrorMessage("Network error. Please check your connection and try again.");
    setState("error");
  }
}

export default function TgEntryPage() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => {
      setSdkLoaded(true);
    };
    script.onerror = () => {
      setErrorMessage("Failed to load Telegram WebApp SDK.");
      setState("error");
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (!sdkLoaded) return;

    const webApp = window.Telegram?.WebApp;
    if (!webApp) {
      setErrorMessage("Telegram WebApp SDK not loaded. Please open this in Telegram.");
      setState("error");
      return;
    }

    applyTelegramTheme(webApp);
    webApp.onEvent?.("themeChanged", () => applyTelegramTheme(webApp));
    webApp.expand();
    webApp.ready();

    if (!webApp.initData || webApp.initData.trim() === "") {
      setErrorMessage("No Telegram data received. Please open this from the bot.");
      setState("error");
      return;
    }

    authenticateWithServer(webApp, router, setState, setErrorMessage);

    return () => {
      webApp.offEvent?.("themeChanged", () => applyTelegramTheme(webApp));
    };
  }, [router, sdkLoaded]);

  if (state === "loading" || !sdkLoaded) {
    return (
      <div className={styles["tgLoading"]}>
        <div className="spinner" role="status" aria-live="polite" />
        <p>Loading Mifluent…</p>
      </div>
    );
  }

  if (state === "authenticating") {
    return (
      <div className={styles["tgLoading"]}>
        <div className="spinner" role="status" aria-live="polite" />
        <p>Signing in…</p>
      </div>
    );
  }

  if (state === "no_account") {
    return (
      <div className={styles["tgShell"]}>
        <main className={styles["tgContent"]}>
          <div className={styles["tgCard"]}>
            <h1 className={styles["tgSectionTitle"]}>Welcome to Mifluent</h1>
            <p style={{ marginBottom: "1rem", color: "var(--tg-text-color)" }}>
              You don't have an account linked to this Telegram user yet.
            </p>
            <p style={{ marginBottom: "1.5rem", color: "var(--tg-hint-color)", fontSize: "14px" }}>
              To use Mifluent, first open the bot and send <code>/start</code>. The bot will create
              your account and link it to this Telegram profile.
            </p>
            <button
              type="button"
              className={`${styles["tgButton"]} ${styles["tgButtonSecondary"]}`}
              onClick={() => window.Telegram?.WebApp?.close()}
            >
              Close
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles["tgShell"]}>
      <main className={styles["tgContent"]}>
        <div className={styles["tgCard"]}>
          <div className={styles["tgError"]}>{errorMessage}</div>
          <button
            type="button"
            className={styles["tgButton"]}
            onClick={() => window.location.reload()}
          >
            Try Again
          </button>
          <button
            type="button"
            className={`${styles["tgButton"]} ${styles["tgButtonSecondary"]}`}
            style={{ marginTop: "0.5rem" }}
            onClick={() => window.Telegram?.WebApp?.close()}
          >
            Close
          </button>
        </div>
      </main>
    </div>
  );
}
