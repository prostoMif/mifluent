import { getConfig } from "@mifluent/core";
import { listRecentUrgentDigests, loadLatestDigestView } from "@mifluent/digest";
import { can, findProfileDelivery, listWatchProfiles } from "@mifluent/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { TelegramBinding } from "@/components/telegram/telegram-binding";
import { DigestCards } from "@/components/today/digest-cards";
import styles from "@/components/today/today.module.css";
import formStyles from "@/components/ui/form.module.css";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../app.module.css";

export const metadata: Metadata = { title: "Today" };

export const dynamic = "force-dynamic";

/** Urgent digests stay at the top of the page for a week. */
const URGENT_SHOWN_DAYS = 7;

interface PageProps {
  readonly searchParams: Promise<{ readonly profile?: string }>;
}

export default async function TodayPage({ searchParams }: PageProps) {
  const session = await requireSessionWith("digest:read");
  const db = getDatabase();
  const profiles = await listWatchProfiles(db, session.tenantId);

  if (profiles.length === 0) {
    return (
      <>
        <h1 className={appStyles["pageTitle"]}>Today</h1>
        <section aria-labelledby="empty-heading" className={appStyles["empty"]}>
          <h2 className={appStyles["emptyTitle"]} id="empty-heading">
            Nothing to show yet
          </h2>
          <p className={appStyles["emptyBody"]}>
            Give Mifluent your site's address and it will work out what to watch — competitors, the
            platforms you depend on, the rules of your market — and build your first digest.
          </p>
          <Link className={formStyles["button"]} href="/watching/start">
            Start with your website
          </Link>
        </section>
      </>
    );
  }

  const { profile: requested } = await searchParams;
  const profile = profiles.find((candidate) => candidate.id === requested) ?? profiles[0];
  if (profile === undefined) return null;

  const since = new Date(Date.now() - URGENT_SHOWN_DAYS * 24 * 60 * 60 * 1000);
  const [digest, urgent, delivery] = await Promise.all([
    loadLatestDigestView(db, session.tenantId, profile.id),
    listRecentUrgentDigests(db, session.tenantId, profile.id, since),
    findProfileDelivery(db, session.tenantId, profile.id),
  ]);
  const config = getConfig();
  const canEdit = can(session.role, "profile:write");

  return (
    <>
      <h1 className={appStyles["pageTitle"]}>Today</h1>
      <p className={appStyles["pageLead"]}>
        What changed around {profile.name}.{" "}
        <Link href={`/watching/${profile.id}`}>Edit what is watched</Link>
      </p>

      {profiles.length > 1 ? (
        <nav aria-label="Profiles" className={styles["profileSwitch"]}>
          {profiles.map((candidate) => (
            <Link
              aria-current={candidate.id === profile.id ? "page" : undefined}
              href={`/today?profile=${candidate.id}`}
              key={candidate.id}
            >
              {candidate.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {urgent.map((view) => (
        <DigestCards canAct={canEdit} digest={view} key={view.id} />
      ))}

      {digest === undefined ? (
        <section className={appStyles["empty"]}>
          <h2 className={appStyles["emptyTitle"]}>No digest yet</h2>
          <p className={appStyles["emptyBody"]}>
            The first one is built once the sources have been read. It appears here, and in Telegram
            if you link it below.
          </p>
        </section>
      ) : (
        <DigestCards canAct={canEdit} digest={digest} />
      )}

      {canEdit && delivery?.telegramChatId === undefined ? (
        <section aria-labelledby="telegram-heading" style={{ marginTop: "2.5rem" }}>
          <h2 id="telegram-heading">Telegram</h2>
          <TelegramBinding
            botUsername={config.TELEGRAM_BOT_USERNAME}
            isBound={false}
            isConfigured={config.features.telegram}
            profileId={profile.id}
          />
        </section>
      ) : null}
    </>
  );
}
