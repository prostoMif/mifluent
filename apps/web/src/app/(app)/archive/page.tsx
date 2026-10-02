import { formatPeriod } from "@mifluent/delivery";
import { listDigestArchive } from "@mifluent/digest";
import { findProfileDelivery, listWatchProfiles } from "@mifluent/domain";
import type { Metadata } from "next";
import { ArchiveList } from "@/components/archive/archive-list";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../app.module.css";

export const metadata: Metadata = { title: "Archive" };

export const dynamic = "force-dynamic";

const TEXT = {
  en: {
    title: "Archive",
    lead: "Every brief so far. Search looks through the headlines.",
    search: "Search headlines",
    urgent: "Urgent",
    quiet: "Quiet — nothing that concerned you",
    none: "Nothing found.",
    empty: "No briefs yet. The first arrives once the sources have been read.",
  },
  ru: {
    title: "Архив",
    lead: "Все сводки. Поиск — по заголовкам.",
    search: "Поиск по заголовкам",
    urgent: "Срочно",
    quiet: "Тихо — ничего, что касается тебя",
    none: "Ничего не нашлось.",
    empty: "Сводок пока нет. Первая придёт, когда прочитаются источники.",
  },
} as const;

interface PageProps {
  readonly searchParams: Promise<{ readonly profile?: string }>;
}

export default async function ArchivePage({ searchParams }: PageProps) {
  const session = await requireSessionWith("digest:read");
  const db = getDatabase();
  const profiles = await listWatchProfiles(db, session.tenantId);
  const { profile: requested } = await searchParams;
  const profile = profiles.find((candidate) => candidate.id === requested) ?? profiles[0];

  const [archive, delivery] =
    profile === undefined
      ? [[], undefined]
      : await Promise.all([
          listDigestArchive(db, session.tenantId, profile.id),
          findProfileDelivery(db, session.tenantId, profile.id),
        ]);
  const timezone = delivery?.timezone ?? "UTC";
  const text = TEXT[archive[0]?.language ?? "en"];

  return (
    <>
      <h1 className={appStyles["pageTitle"]}>{text.title}</h1>
      <p className={appStyles["pageLead"]}>{text.lead}</p>
      {archive.length === 0 ? (
        <section className={appStyles["empty"]}>
          <p className={appStyles["emptyBody"]}>{text.empty}</p>
        </section>
      ) : (
        <ArchiveList
          entries={archive.map((entry) => ({
            id: entry.id,
            label: formatPeriod(entry.periodStart, entry.periodEnd, entry.language, timezone),
            isUrgent: entry.isUrgent,
            headlines: entry.headlines,
          }))}
          text={text}
        />
      )}
    </>
  );
}
