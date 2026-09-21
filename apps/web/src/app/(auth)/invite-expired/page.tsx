import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "That invitation no longer works" };

/**
 * One screen for all three ways an invitation stops working: expired, already
 * used, or never existed.
 *
 * Deliberately not told apart. "Already used" tells whoever is holding the link
 * that it was real and that somebody got in with it, which is more than a
 * stranger who found it in a forwarded message needs to know.
 */
export default function InviteExpiredPage() {
  return (
    <>
      <h1 className={styles["title"]}>That invitation no longer works</h1>

      <Notice tone="neutral">
        Invitations last a week and can only be used once. Ask whoever invited you to send a new
        one.
      </Notice>

      <div className={styles["footer"]}>
        <p>
          Already have an account? <Link href="/sign-in">Sign in</Link>.
        </p>
      </div>
    </>
  );
}
