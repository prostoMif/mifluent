import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Notice } from "@/components/ui/notice";
import { getSignUpAvailability } from "@/lib/registration";
import { getSessionContext } from "@/lib/session";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Create an account" };

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if ((await getSessionContext()) !== undefined) {
    redirect("/today");
  }

  const availability = await getSignUpAvailability();

  if (!availability.isOpen) {
    return <RegistrationClosed />;
  }

  if (availability.isClaimingInstance) {
    return <ClaimInstance />;
  }

  return <JoinInstance invitedEmail={availability.invitedEmail} />;
}

/**
 * The first screen anybody sees on a new instance.
 *
 * No "already have an account?" link here, and that is the point: nobody does.
 * This instance has no accounts at all, which is the entire reason this screen
 * is being shown.
 */
function ClaimInstance() {
  return (
    <>
      <h1 className={styles["title"]}>Set up this instance</h1>

      <p className={styles["lead"]}>
        Nobody has an account here yet. This first one becomes the owner, and sign-up closes behind
        it so that nobody else can walk in and take the instance while you are not looking.
      </p>

      <SignUpForm isClaimingInstance />
    </>
  );
}

function JoinInstance({ invitedEmail }: { readonly invitedEmail: string | undefined }) {
  return (
    <>
      <h1 className={styles["title"]}>
        {invitedEmail === undefined ? "Create an account" : "Accept your invitation"}
      </h1>

      <p className={styles["lead"]}>
        {invitedEmail === undefined
          ? "You are joining an instance that already exists."
          : "Choose a password and you are in. Nobody else, including whoever invited you, ever sees it."}
      </p>

      <SignUpForm isClaimingInstance={false} invitedEmail={invitedEmail} />

      <div className={styles["footer"]}>
        <p>
          Already have an account? <Link href="/sign-in">Sign in</Link>.
        </p>
      </div>
    </>
  );
}

function RegistrationClosed() {
  return (
    <>
      <h1 className={styles["title"]}>Sign-up is closed</h1>

      <Notice tone="neutral">
        This instance already has an owner, so it no longer accepts new accounts. If it is yours,
        you can reopen sign-up with the <code>REGISTRATION_OPEN</code> setting — but remember that
        it opens the door to anyone who knows the address, not only to the person you are waiting
        for.
      </Notice>

      <div className={styles["footer"]}>
        <p>
          <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    </>
  );
}
