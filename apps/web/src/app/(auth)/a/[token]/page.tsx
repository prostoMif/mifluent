import { findEmailCard } from "@mifluent/domain";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { getDatabase } from "@/lib/db";
import { languageOf, readActionToken } from "@/lib/email-links";
import styles from "../../auth.module.css";

export const metadata: Metadata = { title: "Mifluent", robots: { index: false } };

export const dynamic = "force-dynamic";

/**
 * Where a button under a card in a digest email lands.
 *
 * It asks before it acts. Mail scanners open every link in a message, so a
 * link that acted on GET would press every button in every email. The form
 * below posts to /api/a/<token>, which comes back here with ?done=1.
 */

const COPY = {
  en: {
    not_following_target: ["Stop following this target?", "Stop following"],
    not_important: ["Mark this as not important?", "Not important"],
    saved: ["Save this card?", "Save"],
    influenced: ["Did this change a decision?", "Yes, it did"],
    done: "Done. Thank you — this tunes what you get tomorrow.",
    pausedNote: "The target is paused. Turn it back on in the web app any time.",
    expired: "This link no longer works. Email buttons last 30 days.",
    open: "Open today’s brief",
  },
  ru: {
    not_following_target: ["Больше не следить за этой целью?", "Не следить"],
    not_important: ["Отметить как неважное?", "Неважно"],
    saved: ["Сохранить карточку?", "Сохранить"],
    influenced: ["Это повлияло на решение?", "Да, повлияло"],
    done: "Готово. Спасибо — так завтрашняя сводка станет точнее.",
    pausedNote: "Цель на паузе. Включить обратно можно в веб-приложении.",
    expired: "Эта ссылка больше не работает. Кнопки в письмах живут 30 дней.",
    open: "Открыть сегодняшнюю сводку",
  },
} as const;

interface PageProps {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<{ readonly done?: string }>;
}

export default async function EmailActionPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { done } = await searchParams;
  const copy = COPY[languageOf((await headers()).get("accept-language"))];

  const parsed = readActionToken(token);
  const card = parsed === undefined ? undefined : await findEmailCard(getDatabase(), parsed.cardId);

  if (parsed === undefined || card === undefined) {
    return (
      <>
        <Notice tone="neutral">{copy.expired}</Notice>
        <div className={styles["footer"]}>
          <p>
            <Link href="/today">{copy.open}</Link>
          </p>
        </div>
      </>
    );
  }

  const [question, button] = copy[parsed.action];

  if (done === "1") {
    return (
      <>
        <h1 className={styles["title"]}>{copy.done}</h1>
        {parsed.action === "not_following_target" && (
          <p className={styles["lead"]}>{copy.pausedNote}</p>
        )}
        <div className={styles["footer"]}>
          <p>
            <Link href="/today">{copy.open}</Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className={styles["title"]}>{question}</h1>
      <p className={styles["lead"]}>{card.headline}</p>
      <form method="post" action={`/api/a/${encodeURIComponent(token)}`}>
        <button className={formStyles["button"]} type="submit">
          {button}
        </button>
      </form>
    </>
  );
}
