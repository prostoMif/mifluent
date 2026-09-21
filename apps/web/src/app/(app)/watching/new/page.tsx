import type { Metadata } from "next";
import { WatchProfileForm } from "@/components/profiles/watch-profile-form";
import { requireSessionWith } from "@/lib/session";
import appStyles from "../../app.module.css";

export const metadata: Metadata = { title: "New watch profile" };

export const dynamic = "force-dynamic";

export default async function NewWatchProfilePage() {
  // Checked here as well as in the API route. The page would otherwise render a
  // form that fails on save, which reads as a broken product rather than as a
  // permission the person does not have.
  await requireSessionWith("profile:write");

  return (
    <>
      <h1 className={appStyles["pageTitle"]}>New watch profile</h1>
      <p className={appStyles["pageLead"]}>
        Describe the business first. The rest can be filled in later, or worked out for you.
      </p>

      <WatchProfileForm />
    </>
  );
}
