"use client";

/**
 * Onboarding, start to first digest (TASK-011).
 *
 * 1. One field: the site's address, or a sentence about the business.
 * 2. The worker reads the site; this page asks how it is going every two
 *    seconds.
 * 3. "Here is what I understood": facts, targets and where each is read
 *    from, all editable. "Continue" is never disabled — editing is optional.
 * 4. The first run, as live counts, then `/today`.
 */

import type { DiscoveryResult } from "@mifluent/discovery";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import { DiscoveryReview } from "./discovery-review";
import { FirstRunProgress } from "./first-run-progress";
import styles from "./onboarding.module.css";

type Stage =
  | { readonly kind: "input"; readonly message?: string }
  | { readonly kind: "reading"; readonly runId: string; readonly input: string }
  | { readonly kind: "review"; readonly result: DiscoveryResult; readonly input: string }
  | { readonly kind: "progress"; readonly profileId: string; readonly runId: string };

type DiscoveryStatus =
  | { readonly state: "running" }
  | { readonly state: "completed"; readonly result: DiscoveryResult }
  | { readonly state: "failed"; readonly error?: { readonly message: string } };

export interface OnboardingFlowProps {
  readonly discoveriesLeft: number;
  readonly discoveriesPerMonth: number;
  /** Targets the plan still allows; the review screen pre-selects this many. */
  readonly targetsLeft: number;
}

/** How often the page asks whether the site has been read. */
const POLL_INTERVAL_MS = 2_000;

export function OnboardingFlow({
  discoveriesLeft,
  discoveriesPerMonth,
  targetsLeft,
}: OnboardingFlowProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "input" });
  const [language, setLanguage] = useState<"en" | "ru">("en");

  useEffect(() => {
    // The reader's language, from the browser, as the starting choice.
    setLanguage(navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en");
  }, []);

  useEffect(() => {
    if (stage.kind !== "reading") return undefined;
    const timer = setInterval(() => {
      void checkDiscovery(stage.runId, stage.input, setStage);
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [stage]);

  switch (stage.kind) {
    case "input":
      return (
        <DiscoveryInput
          discoveriesLeft={discoveriesLeft}
          discoveriesPerMonth={discoveriesPerMonth}
          language={language}
          message={stage.message}
          onLanguageChange={setLanguage}
          onStarted={(runId, input) => {
            setStage({ kind: "reading", runId, input });
          }}
        />
      );
    case "reading":
      return (
        <div className={styles["stage"]}>
          <Notice tone="neutral">
            Reading {stage.input.startsWith("http") ? stage.input : "your description"} and working
            out what to watch. This takes a minute or two.
          </Notice>
        </div>
      );
    case "review":
      return (
        <DiscoveryReview
          input={stage.input}
          language={language}
          onSaved={(profileId, runId) => {
            setStage({ kind: "progress", profileId, runId });
          }}
          result={stage.result}
          targetsLeft={targetsLeft}
        />
      );
    case "progress":
      return (
        <FirstRunProgress
          onReady={() => {
            router.push(`/today?profile=${stage.profileId}`);
            router.refresh();
          }}
          profileId={stage.profileId}
          runId={stage.runId}
        />
      );
  }
}

async function checkDiscovery(
  runId: string,
  input: string,
  setStage: (stage: Stage) => void,
): Promise<void> {
  try {
    const status = await readDiscovery(runId);
    if (status.state === "running") return;

    if (status.state === "failed") {
      setStage({
        kind: "input",
        message: status.error?.message ?? "Reading the site failed. Try again.",
      });
      return;
    }

    if (status.result.needsDescription) {
      setStage({
        kind: "input",
        message:
          "The site says too little to work from. Describe the business in a sentence instead.",
      });
      return;
    }

    setStage({ kind: "review", result: status.result, input });
  } catch (thrown) {
    setStage({ kind: "input", message: toDisplayMessage(thrown) });
  }
}

function readDiscovery(runId: string): Promise<DiscoveryStatus> {
  return sendRequest<DiscoveryStatus>({ method: "GET", path: `/api/discovery/${runId}` });
}

interface DiscoveryInputProps {
  readonly discoveriesLeft: number;
  readonly discoveriesPerMonth: number;
  readonly language: "en" | "ru";
  readonly message: string | undefined;
  readonly onLanguageChange: (language: "en" | "ru") => void;
  readonly onStarted: (runId: string, input: string) => void;
}

function DiscoveryInput(props: DiscoveryInputProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const input = String(new FormData(event.currentTarget).get("input") ?? "").trim();

    setIsPending(true);
    setError(undefined);
    try {
      const { runId } = await sendRequest<{ runId: string }>({
        method: "POST",
        path: "/api/discovery",
        body: { input, language: props.language },
      });
      props.onStarted(runId, input);
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setIsPending(false);
    }
  }

  const isOut = props.discoveriesLeft === 0;

  return (
    <form className={formStyles["form"]} noValidate onSubmit={handleSubmit}>
      {props.message === undefined ? null : <Notice tone="neutral">{props.message}</Notice>}
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}

      <TextField
        autoComplete="url"
        hint="For example https://example.com — or “We sell handmade tea in Telegram to buyers in Russia”."
        id="onboarding-input"
        label="Your site's address, or what you do in one sentence"
        name="input"
        required
      />

      <div className={formStyles["field"]}>
        <label className={formStyles["label"]} htmlFor="onboarding-language">
          Language of the digest
        </label>
        <select
          className={formStyles["control"]}
          id="onboarding-language"
          onChange={(event) => {
            props.onLanguageChange(event.target.value === "ru" ? "ru" : "en");
          }}
          value={props.language}
        >
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
      </div>

      <p className={formStyles["hint"]}>
        {isOut
          ? `You have used all ${props.discoveriesPerMonth} site readings for this month.`
          : `This takes about two minutes and uses one of ${props.discoveriesLeft} site readings left this month.`}
      </p>

      {isOut ? null : (
        <div className={formStyles["actions"]}>
          <SubmitButton isPending={isPending} label="Continue" pendingLabel="Starting…" />
        </div>
      )}
    </form>
  );
}
