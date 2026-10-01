import type { Metadata } from "next";
import { headers } from "next/headers";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { languageOf, readUnsubscribeToken } from "@/lib/email-links";
import styles from "../../auth.module.css";

export const metadata: Metadata = { title: "Mifluent", robots: { index: false } };

export const dynamic = "force-dynamic";

/**
 * The "Unsubscribe" link at the foot of a digest email.
 *
 * Asks before acting, for the same reason as the card buttons: scanners open
 * links. Inbox one-click unsubscribe skips this page and posts straight to the
 * API. After stopping, the same page offers to start again — the commonest
 * unsubscribe is a mis-tap.
 */

const COPY = {
  en: {
    question: "Stop the email brief?",
    lead: "Emails stop for this brief. Your account, targets and the web app stay as they are.",
    stop: "Stop emails",
    paused: "Emails stopped.",
    pausedLead: "Changed your mind?",
    resume: "Send them again",
    resumed: "Emails are back on. The next brief comes at the usual time.",
    expired: "This link no longer works. Unsubscribe from the newest email instead.",
  },
  ru: {
    question: "Отключить сводку на почту?",
    lead: "Письма перестанут приходить. Аккаунт, цели и веб-приложение останутся как есть.",
    stop: "Отключить письма",
    paused: "Письма отключены.",
    pausedLead: "Передумали?",
    resume: "Включить обратно",
    resumed: "Письма снова включены. Следующая сводка придёт в обычное время.",
    expired: "Эта ссылка больше не работает. Отпишитесь по ссылке из последнего письма.",
  },
} as const;

interface PageProps {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<{ readonly done?: string }>;
}

export default async function UnsubscribePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { done } = await searchParams;
  const copy = COPY[languageOf((await headers()).get("accept-language"))];
  const action = `/api/unsubscribe/${encodeURIComponent(token)}`;

  if (readUnsubscribeToken(token) === undefined) {
    return <Notice tone="neutral">{copy.expired}</Notice>;
  }

  if (done === "resumed") {
    return <h1 className={styles["title"]}>{copy.resumed}</h1>;
  }

  if (done === "paused") {
    return (
      <>
        <h1 className={styles["title"]}>{copy.paused}</h1>
        <p className={styles["lead"]}>{copy.pausedLead}</p>
        <form method="post" action={action}>
          <input type="hidden" name="from" value="page" />
          <input type="hidden" name="resume" value="1" />
          <button className={formStyles["button"]} type="submit">
            {copy.resume}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 className={styles["title"]}>{copy.question}</h1>
      <p className={styles["lead"]}>{copy.lead}</p>
      <form method="post" action={action}>
        <input type="hidden" name="from" value="page" />
        <button className={formStyles["button"]} type="submit">
          {copy.stop}
        </button>
      </form>
    </>
  );
}
