import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Notice } from "@/components/ui/notice";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Choose a new password" };

export const dynamic = "force-dynamic";

interface ResetPasswordPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readToken(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  /*
   * Better Auth's own callback checks the token and bounces the browser here,
   * adding either `token` or `error`. So a missing token means the link was
   * expired, already used, or edited — not something to distinguish, because
   * the answer is the same in all three cases: ask for a new one.
   */
  const token = readToken((await searchParams)["token"]);

  if (token === undefined) {
    return (
      <>
        <h1 className={styles["title"]}>That link no longer works</h1>
        <Notice tone="error">
          Reset links last an hour and can only be used once. Ask for a new one.
        </Notice>
        <div className={styles["footer"]}>
          <p>
            <Link href="/forgot-password">Send another link</Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className={styles["title"]}>Choose a new password</h1>
      <p className={styles["lead"]}>
        Saving this signs you out everywhere else, including any device you no longer have.
      </p>

      <ResetPasswordForm token={token} />
    </>
  );
}
