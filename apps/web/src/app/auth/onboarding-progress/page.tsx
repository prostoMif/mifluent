"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FirstRunProgress } from "@/components/onboarding/first-run-progress";

export default function OnboardingProgressPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pending = searchParams.get("pending") ?? "";
  const [profileId, setProfileId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    // Poll for profile creation
    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/onboarding-status?pending=${pending}`);
        const data = await res.json();
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
