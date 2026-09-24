import { getConfig, isUuid } from "@mifluent/core";
import { can, findProfileDelivery, findWatchProfile, listSources } from "@mifluent/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeleteProfileButton } from "@/components/profiles/delete-profile-button";
import { SourcesPanel } from "@/components/profiles/sources-panel";
import { WatchProfileForm } from "@/components/profiles/watch-profile-form";
import { TelegramBinding } from "@/components/telegram/telegram-binding";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../../app.module.css";

export const metadata: Metadata = { title: "Watch profile" };

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly profileId: string }>;
}

export default async function WatchProfilePage({ params }: PageProps) {
  const session = await requireSessionWith("profile:read");
  const { profileId } = await params;

  if (!isUuid(profileId)) {
    notFound();
  }

  /*
   * The tenant comes from the session, so a profile belonging to somebody else
   * is not found rather than forbidden — same answer as one that never existed,
   * which is what stops this page from confirming what other people watch.
   */
  const profile = await findWatchProfile(getDatabase(), session.tenantId, profileId);

  if (profile === undefined) {
    notFound();
  }

  const sources = await listSources(getDatabase(), session.tenantId, profile.id);
  const delivery = await findProfileDelivery(getDatabase(), session.tenantId, profile.id);
  const canEdit = can(session.role, "profile:write");
  const config = getConfig();

  return (
    <>
      <h1 className={appStyles["pageTitle"]}>{profile.name}</h1>
      <p className={appStyles["pageLead"]}>
        {profile.currentVersion === null
          ? "No version recorded yet."
          : `Version ${profile.currentVersion}. A new one is recorded only when a change affects what gets selected — renaming this profile does not.`}
      </p>

      <WatchProfileForm profile={profile} />

      <SourcesPanel canEdit={canEdit} profileId={profile.id} sources={sources} />

      {canEdit ? (
        <section aria-labelledby="telegram-heading" style={{ marginTop: "2.5rem" }}>
          <h2 id="telegram-heading">Telegram</h2>
          <TelegramBinding
            botUsername={config.TELEGRAM_BOT_USERNAME}
            isBound={delivery?.telegramChatId !== undefined}
            isConfigured={config.features.telegram}
            profileId={profile.id}
          />
        </section>
      ) : null}

      {canEdit ? (
        <section aria-labelledby="danger-heading" style={{ marginTop: "2.5rem" }}>
          <h2 id="danger-heading">Removing it</h2>
          <DeleteProfileButton profileId={profile.id} profileName={profile.name} />
        </section>
      ) : null}
    </>
  );
}
