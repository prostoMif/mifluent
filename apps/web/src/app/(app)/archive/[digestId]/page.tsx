import { isUuid } from "@mifluent/core";
import { loadDigestView } from "@mifluent/digest";
import { can, findProfileDelivery } from "@mifluent/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DigestCards } from "@/components/today/digest-cards";
import { getDatabase } from "@/lib/db";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../../app.module.css";

export const metadata: Metadata = { title: "Brief" };

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly digestId: string }>;
}

/** One past brief, exactly as it was sent. Scoped to the reader's tenant. */
export default async function ArchivedDigestPage({ params }: PageProps) {
  const session = await requireSessionWith("digest:read");
  const { digestId } = await params;
  if (!isUuid(digestId)) notFound();

  const db = getDatabase();
  const digest = await loadDigestView(db, session.tenantId, digestId);
  if (digest === undefined) notFound();
  const delivery = await findProfileDelivery(db, session.tenantId, digest.profileId);

  return (
    <>
      <p className={appStyles["pageLead"]}>
        <Link href="/archive">← {digest.language === "ru" ? "Архив" : "Archive"}</Link>
      </p>
      <h1 className={appStyles["pageTitle"]}>{digest.profileName}</h1>
      <DigestCards
        canAct={can(session.role, "profile:write")}
        digest={digest}
        timezone={delivery?.timezone ?? "UTC"}
      />
    </>
  );
}
