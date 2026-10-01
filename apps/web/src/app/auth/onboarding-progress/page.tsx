"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FirstRunProgress } from "@/components/onboarding/first-run-progress";

function OnboardingProgressContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pending = searchParams.get("pending") ?? "";
  const [profileId, setProfileId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    // Poll for profile creation
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/auth/onboarding-status?pending=${encodeURIComponent(pending)}`,
        );
        // Every API answer is wrapped: { ok, data } or { ok: false, error }.
        const body = await res.json();
        const data = body.data ?? { error: body.error };
        if (data.profileId && data.runId) {
          setProfileId(data.profileId);
          setRunId(data.runId);
        } else if (data.error) {
          console.error("Onboarding failed:", data.error);
          router.push("/today");
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    };

    const interval = setInterval(poll, 1000);
    poll(); // Initial check

    return () => clearInterval(interval);
  }, [pending, router]);

  if (!profileId || !runId) {
    return (
      <div className="onboarding-progress">
        <h2>Setting up your account…</h2>
        <p>Creating your profile and starting the first monitoring run.</p>
      </div>
    );
  }

  return (
    <FirstRunProgress profileId={profileId} runId={runId} onReady={() => router.push("/today")} />
  );
}

/**
 * The page reads its query string on the client; Next.js renders it inside a
 * Suspense boundary so the rest of the page can be built ahead of time.
 */
export default function OnboardingProgressPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingProgressContent />
    </Suspense>
  );
}
