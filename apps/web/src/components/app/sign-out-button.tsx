"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/ui/form.module.css";
import { authClient } from "@/lib/auth-client";

/**
 * Signing out is a button, not a link.
 *
 * A link would be a GET, and a GET that ends a session can be triggered by any
 * page that manages to get the browser to load it — an image tag is enough.
 * Annoying rather than dangerous, but trivial to avoid.
 */
export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick(): Promise<void> {
    setIsPending(true);
    await authClient.signOut();

    router.push("/sign-in");
    // The shell above renders from the session. Without this it keeps showing
    // the signed-in header until the next full page load.
    router.refresh();
  }

  return (
    <button
      className={`${styles["button"]} ${styles["secondary"]}`}
      disabled={isPending}
      onClick={handleClick}
      type="button"
    >
      {isPending ? "Signing out…" : "Sign out"}
    </button>
  );
}
