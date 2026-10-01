"use client";

import styles from "./targets.module.css";

interface Vacancy {
  readonly title: string;
  readonly url: string | null;
  readonly department: string | null;
  readonly location: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly isOpen: boolean;
}

interface VacanciesProps {
  readonly vacancies: readonly Vacancy[];
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

export function Vacancies({ vacancies }: VacanciesProps) {
  if (vacancies.length === 0) {
    return (
      <section className={styles["vacancies"]} aria-labelledby="vacancies-heading">
        <h2 id="vacancies-heading" className={styles["sectionTitle"]}>
          Vacancies
        </h2>
        <p className={styles["emptyVacancies"]}>No vacancies found.</p>
      </section>
    );
  }

  const openVacancies = vacancies.filter((v) => v.isOpen);
  const closedVacancies = vacancies.filter((v) => !v.isOpen);

  return (
    <section className={styles["vacancies"]} aria-labelledby="vacancies-heading">
      <h2 id="vacancies-heading" className={styles["sectionTitle"]}>
        Vacancies
        {openVacancies.length > 0 && (
          <span className={styles["vacancyCount"]}>{openVacancies.length} open</span>
        )}
      </h2>

      {openVacancies.length > 0 && (
        <div className={styles["vacancyList"]}>
          <h3 className={styles["vacancySubtitle"]}>Currently open</h3>
          <ul>
            {openVacancies.map((vacancy) => (
              <li key={vacancy.title} className={styles["vacancyItem"]}>
                <div className={styles["vacancyMain"]}>
                  {vacancy.url ? (
                    <a
                      href={vacancy.url}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                      className={styles["vacancyTitle"]}
                    >
                      {vacancy.title}
                    </a>
                  ) : (
                    <span className={styles["vacancyTitle"]}>{vacancy.title}</span>
                  )}
                  <div className={styles["vacancyMeta"]}>
                    {vacancy.department && <span>{vacancy.department}</span>}
                    {vacancy.location && <span>{vacancy.location}</span>}
                    <time dateTime={vacancy.firstSeenAt} className={styles["vacancyDate"]}>
                      First seen {formatDate(vacancy.firstSeenAt)}
                    </time>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {closedVacancies.length > 0 && (
        <details className={styles["closedVacancies"]}>
          <summary className={styles["closedVacanciesSummary"]}>
            {closedVacancies.length} closed or removed in the last 90 days
          </summary>
          <ul>
            {closedVacancies.map((vacancy) => (
              <li key={vacancy.title} className={styles["vacancyItem"]}>
                <div className={styles["vacancyMain"]}>
                  {vacancy.url ? (
                    <a
                      href={vacancy.url}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                      className={styles["vacancyTitle"]}
                    >
                      {vacancy.title}
                    </a>
                  ) : (
                    <span className={styles["vacancyTitle"]}>{vacancy.title}</span>
                  )}
                  <div className={styles["vacancyMeta"]}>
                    {vacancy.department && <span>{vacancy.department}</span>}
                    {vacancy.location && <span>{vacancy.location}</span>}
                    <time dateTime={vacancy.lastSeenAt} className={styles["vacancyDate"]}>
                      Last seen {formatDate(vacancy.lastSeenAt)}
                    </time>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
