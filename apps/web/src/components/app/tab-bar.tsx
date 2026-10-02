"use client";

/**
 * Bottom tabs, shown only inside Telegram (where the site header is hidden):
 * the Mini App's navigation, within thumb reach.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/(app)/app.module.css";

const TABS = {
  en: [
    { href: "/today", label: "Today", icon: "☀" },
    { href: "/archive", label: "Archive", icon: "▤" },
    { href: "/watching", label: "Watching", icon: "◎" },
    { href: "/settings", label: "Settings", icon: "⚙" },
  ],
  ru: [
    { href: "/today", label: "Сегодня", icon: "☀" },
    { href: "/archive", label: "Архив", icon: "▤" },
    { href: "/watching", label: "Цели", icon: "◎" },
    { href: "/settings", label: "Настройки", icon: "⚙" },
  ],
} as const;

export function TabBar({ language }: { readonly language: "en" | "ru" }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className={styles["tabBar"]}>
      {TABS[language].map((tab) => {
        const isCurrent = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            aria-current={isCurrent ? "page" : undefined}
            className={`${styles["tab"]} ${isCurrent ? styles["tabCurrent"] : ""}`}
            href={tab.href}
            key={tab.href}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
