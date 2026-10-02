"use client";

/**
 * Past digests with a search box. The search runs over what is already on
 * the page — the headlines of the last months — so it answers instantly and
 * sends nothing anywhere.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import formStyles from "@/components/ui/form.module.css";
import styles from "./archive.module.css";

export interface ArchiveEntry {
  readonly id: string;
  readonly label: string;
  readonly isUrgent: boolean;
  readonly headlines: readonly string[];
}

export function ArchiveList({
  entries,
  text,
}: {
  readonly entries: readonly ArchiveEntry[];
  readonly text: {
    readonly search: string;
    readonly urgent: string;
    readonly quiet: string;
    readonly none: string;
  };
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (words === "") return entries;
    return entries.filter((entry) =>
      entry.headlines.some((headline) => headline.toLowerCase().includes(words)),
    );
  }, [entries, query]);

  return (
    <>
      <label className={styles["search"]}>
        <span className={styles["srOnly"]}>{text.search}</span>
        <input
          className={formStyles["control"]}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={text.search}
          type="search"
          value={query}
        />
      </label>
      {shown.length === 0 ? (
        <p className={styles["muted"]}>{text.none}</p>
      ) : (
        <ul className={styles["list"]}>
          {shown.map((entry) => (
            <li key={entry.id}>
              <Link className={styles["item"]} href={`/archive/${entry.id}`}>
                <span className={styles["date"]}>
                  {entry.isUrgent ? `${text.urgent} · ` : ""}
                  {entry.label}
                </span>
                <span className={styles["headlines"]}>
                  {entry.headlines.length === 0
                    ? text.quiet
                    : entry.headlines.slice(0, 3).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
