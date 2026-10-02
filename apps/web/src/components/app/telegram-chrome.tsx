"use client";

/**
 * When the app runs inside Telegram as a Mini App: hide the site's header,
 * take Telegram's colours, show Telegram's own Back button off the main
 * screen, and expand to full height. Outside Telegram it does nothing.
 *
 * The SDK is only present when /tg loaded it, which is how a Mini App
 * session starts; the flag survives client-side navigation.
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

interface TelegramWebApp {
  readonly colorScheme?: "light" | "dark";
  readonly themeParams?: Readonly<Record<string, string | undefined>>;
  expand?: () => void;
  readonly BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
}

function webApp(): TelegramWebApp | undefined {
  const telegram = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram;
  return telegram?.WebApp?.themeParams === undefined ? undefined : telegram.WebApp;
}

/** Telegram's theme keys → our tokens. */
const TOKENS: ReadonlyArray<readonly [string, string]> = [
  ["bg_color", "--colour-background"],
  ["secondary_bg_color", "--colour-surface"],
  ["text_color", "--colour-text"],
  ["hint_color", "--colour-text-muted"],
  ["button_color", "--colour-accent"],
  ["button_text_color", "--colour-accent-contrast"],
];

const SESSION_FLAG = "mifluent.tg";

function isInsideTelegram(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_FLAG) === "1") return true;
  } catch {
    // Storage blocked: fall through to the other signs.
  }
  return "TelegramWebviewProxy" in window || window.location.hash.includes("tgWebAppData");
}

function applyTelegramLook(): void {
  const app = webApp();
  if (app === undefined) return;
  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    // Storage blocked: the look still applies to this page.
  }
  const root = document.documentElement;
  root.dataset["tg"] = "1";
  if (app.colorScheme !== undefined) root.dataset["theme"] = app.colorScheme;
  for (const [key, token] of TOKENS) {
    const value = app.themeParams?.[key];
    if (value !== undefined) root.style.setProperty(token, value);
  }
  app.expand?.();
}

export function TelegramChrome() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (webApp() !== undefined) {
      applyTelegramLook();
      return;
    }
    // A full page load inside Telegram (a link from a message) has no SDK
    // yet: load it, then apply the look. Nothing is loaded in a browser.
    if (!isInsideTelegram()) return;
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.onload = applyTelegramLook;
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    const back = webApp()?.BackButton;
    if (back === undefined) return;
    const goBack = () => router.back();
    if (pathname === "/today") {
      back.hide();
      return;
    }
    back.show();
    back.onClick(goBack);
    return () => back.offClick(goBack);
  }, [pathname, router]);

  return null;
}
