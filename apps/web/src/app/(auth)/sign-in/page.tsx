import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { isSignUpOpen } from "@/lib/registration";
import { getSessionContext } from "@/lib/session";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Sign in" };

// Reads the session and the database, so it is never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if ((await getSessionContext()) !== undefined) {
    redirect("/today");
  }

  const canSignUp = await isSignUpOpen();

  return (
    <>
      <h1 className={styles["title"]}>Sign in</h1>

      <SignInForm />

      <div className={styles["footer"]}>
        <p>
          <Link href="/forgot-password">Forgotten your password?</Link>
        </p>
        {canSignUp ? (
          <p>
            No account yet? <Link href="/sign-up">Create one</Link>.
          </p>
        ) : null}
      </div>
    </>
  );
}
