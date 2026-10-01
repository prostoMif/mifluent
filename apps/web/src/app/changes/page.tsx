import type { Metadata } from "next";
import Link from "next/link";
import { loadRadarChanges, loadRadarCompanies, radarTenantId } from "@/lib/radar";
import { ChangeItem } from "./change-item";
import styles from "./changes.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing & policy changes at SaaS companies and marketplaces",
  description:
    "A public, sourced log of price, plan and policy changes at Notion, Figma, Slack, Wildberries, Ozon and more — each with a verbatim quote and a link to the original.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/changes" },
};

interface PageProps {
  readonly searchParams: Promise<{ readonly lang?: string }>;
}

/** The public radar's feed: every verified change, newest first. */
export default async function ChangesPage({ searchParams }: PageProps) {
  const tenantId = radarTenantId();
  const { lang } = await searchParams;
  const language = lang === "en" || lang === "ru" ? lang : "all";

  if (tenantId === undefined) {
    return (
      <div className={styles["page"]}>
        <h1 className={styles["title"]}>Changes</h1>
        <p className={styles["lead"]}>The public radar is not running on this instance.</p>
      </div>
    );
  }

  const [changes, companies] = await Promise.all([
    loadRadarChanges(tenantId, language),
    loadRadarCompanies(tenantId),
  ]);

  return (
    <div className={styles["page"]}>
      <p className={styles["eyebrow"]}>Mifluent radar</p>
      <h1 className={styles["title"]}>What changed in prices and rules</h1>
      <p className={styles["lead"]}>
        Price, plan and policy changes at the services businesses pay for. Every entry quotes the
        source word for word and links to it. Изменения тарифов и правил площадок — со ссылкой на
        первоисточник.
      </p>

      <nav className={styles["filters"]} aria-label="Language">
        {(["all", "en", "ru"] as const).map((option) => (
          <Link
            key={option}
            href={option === "all" ? "/changes" : `/changes?lang=${option}`}
            className={`${styles["filter"]} ${option === language ? styles["filterCurrent"] : ""}`}
            aria-current={option === language ? "page" : undefined}
          >
            {option === "all" ? "All" : option === "en" ? "SaaS (EN)" : "Сервисы РФ"}
          </Link>
        ))}
      </nav>

      {changes.length === 0 ? (
        <p className={styles["lead"]}>Nothing verified yet — the radar is warming up.</p>
      ) : (
        <ul className={styles["list"]}>
          {changes.map((change) => (
            <ChangeItem
              key={`${change.slug}-${change.occurredAt.toISOString()}-${change.summary}`}
              change={change}
              showCompany
            />
          ))}
        </ul>
      )}

      <section className={styles["cta"]}>
        <p>
          Get this for your own competitors, every morning. <Link href="/start">Start free →</Link>
        </p>
      </section>

      <nav className={styles["companies"]} aria-label="Companies">
        {companies.map((company) => (
          <Link key={company.slug} href={`/changes/${company.slug}`}>
            {company.name}
          </Link>
        ))}
      </nav>
    </div>
  );
}
