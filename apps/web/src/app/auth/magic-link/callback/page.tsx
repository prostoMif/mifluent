import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MagicLinkCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const { pending } = await searchParams;

  // Better Auth handles the token verification automatically
  // We just need to redirect to the appropriate page
  // The after hook in auth.ts will complete the onboarding

  if (pending) {
    // Redirect to progress page to show first run progress
    redirect(`/auth/onboarding-progress?pending=${pending}`);
  }

  // No pending - just go to today
  redirect("/today");
}
