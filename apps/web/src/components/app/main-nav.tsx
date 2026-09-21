"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/(app)/app.module.css";

interface NavItem {
  readonly href: string;
  readonly label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/today", label: "Today" },
  { href: "/watching", label: "Watching" },
  { href: "/settings", label: "Settings" },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className={styles["nav"]}>
      {NAV_ITEMS.map((item) => {
        const isCurrent = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            aria-current={isCurrent ? "page" : undefined}
            className={`${styles["navLink"]} ${isCurrent ? styles["navLinkCurrent"] : ""}`}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
