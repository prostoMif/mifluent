import { getConfig } from "@mifluent/core";
import type { PublicCompanyPage } from "@mifluent/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRadarCompany, radarTenantId } from "@/lib/radar";
import { ChangeItem } from "../change-item";
import styles from "../changes.module.css";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const tenantId = radarTenantId();
  const page =
    tenantId === undefined ? undefined : await loadRadarCompany(tenantId, (await params).slug);
  if (page === undefined) return { title: "Not found", robots: { index: false } };
  const { name, language } = page.company;
  return language === "ru"
    ? {
        title: `${name}: история изменений тарифов и правил`,
        description: `Все изменения цен, комиссий и правил ${name} с цитатой и ссылкой на первоисточник.`,
        robots: { index: true, follow: true },
        alternates: { canonical: `/changes/${page.company.slug}` },
      }
    : {
        title: `${name} pricing changes history`,
        description: `Every ${name} price, plan and policy change, with a verbatim quote and a link to the source.`,
        robots: { index: true, follow: true },
        alternates: { canonical: `/changes/${page.company.slug}` },
      };
}

/** One company's public history: price table, then every verified change. */
export default async function CompanyChangesPage({ params }: PageProps) {
  const tenantId = radarTenantId();
  if (tenantId === undefined) notFound();
  const page = await loadRadarCompany(tenantId, (await params).slug);
  if (page === undefined) notFound();

  const { company, changes, priceChanges } = page;
  const ru = company.language === "ru";

  return (
    <div className={styles["page"]}>
      <p className={styles["eyebrow"]}>
        <Link href="/changes">{ru ? "Радар Mifluent" : "Mifluent radar"}</Link>
        {company.category === null ? null : ` · ${company.category}`}
      </p>
      <h1 className={styles["title"]}>
        {ru ? `${company.name}: изменения тарифов и правил` : `${company.name} pricing changes`}
      </h1>
      <p className={styles["lead"]}>
        {ru
          ? "Каждое изменение — с дословной цитатой и ссылкой на первоисточник."
          : "Every change, with a verbatim quote and a link to the original source."}
        {company.website === null ? null : (
          <>
            {" "}
            <a href={company.website} rel="nofollow noopener" target="_blank">
              {company.website.replace(/^https?:\/\//, "")}
            </a>
          </>
        )}
      </p>

      <PriceTable changes={priceChanges} ru={ru} />

      {changes.length === 0 ? (
        <p className={styles["lead"]}>
          {ru ? "Пока изменений не найдено." : "No changes recorded yet."}
        </p>
      ) : (
        <ul className={styles["list"]}>
          {changes.map((change) => (
            <ChangeItem
              key={`${change.occurredAt.toISOString()}-${change.summary}`}
              change={change}
              showCompany={false}
            />
          ))}
        </ul>
      )}

      <CallToAction ru={ru} botLink={getConfig().RADAR_BOT_LINK} />
    </div>
  );
}

function PriceTable({
  changes,
  ru,
}: {
  readonly changes: PublicCompanyPage["priceChanges"];
  readonly ru: boolean;
}) {
  if (changes.length === 0) return null;
  const dateFormat = new Intl.DateTimeFormat(ru ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <div className={styles["tableWrap"]}>
      <table className={styles["table"]}>
        <caption className={styles["eyebrow"]}>{ru ? "Цены и тарифы" : "Prices and plans"}</caption>
        <thead>
          <tr>
            <th>{ru ? "Дата" : "Date"}</th>
            <th>{ru ? "Было" : "Was"}</th>
            <th>{ru ? "Стало" : "Became"}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={`${change.occurredAt.toISOString()}-${change.became}`}>
              <td>{dateFormat.format(change.occurredAt)}</td>
              <td>{change.was ?? "—"}</td>
              <td>
                {change.sourceUrl === null ? (
                  change.became
                ) : (
                  <a href={change.sourceUrl} rel="nofollow noopener" target="_blank">
                    {change.became}
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CallToAction({
  ru,
  botLink,
}: {
  readonly ru: boolean;
  readonly botLink: string | undefined;
}) {
  return (
    <section className={styles["cta"]}>
      {ru ? (
        <p>
          Такое про своих конкурентов — каждое утро в Telegram.{" "}
          <a href={botLink ?? "/start"}>Открыть бота →</a>
        </p>
      ) : (
        <p>
          Get this for your own competitors, every morning. <Link href="/start">Start free →</Link>
        </p>
      )}
    </section>
  );
}
