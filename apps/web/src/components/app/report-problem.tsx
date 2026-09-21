"use client";

import { useState } from "react";
import styles from "@/app/(app)/app.module.css";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { TextAreaField } from "@/components/ui/text-area-field";

export interface ReportProblemProps {
  /** Shown in the report so a fix can be matched to a build. */
  readonly version: string;
  /** From `ISSUE_TRACKER_URL`. Absent on an instance that has none. */
  readonly issueTrackerUrl?: string | undefined;
}

/*
 * The report is assembled in the browser and handed back to the person. It is
 * not sent anywhere.
 *
 * That is the whole design, and it follows from a rule in docs/security.md:
 * what happens on somebody's self-hosted instance stays on their instance.
 * A button that quietly posted the page they were on, their browser and their
 * description to a server they do not control would be exactly the thing they
 * self-hosted to avoid — and the first person to watch their own outbound
 * traffic would be right to be angry about it.
 *
 * So the button does the boring part — collecting the details a maintainer
 * always has to ask for — and the person decides whether to send it.
 */
export function ReportProblem({ version, issueTrackerUrl }: ReportProblemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");

  if (!isOpen) {
    return (
      <button
        className={styles["footerButton"]}
        onClick={() => {
          setIsOpen(true);
        }}
        type="button"
      >
        Report a problem
      </button>
    );
  }

  const report = composeReport({ description, version });

  async function handleCopy(): Promise<void> {
    /*
     * `navigator.clipboard` only exists in a secure context, and an instance
     * reached over plain http on a local network is not one. Rather than a
     * button that silently does nothing there, fall back to selecting the text
     * and saying which keys to press.
     */
    if (navigator.clipboard === undefined) {
      setCopyState("manual");
      return;
    }

    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }

  return (
    <section aria-labelledby="report-heading" className={styles["reportPanel"]}>
      <h2 className={styles["reportTitle"]} id="report-heading">
        Report a problem
      </h2>

      <Notice tone="neutral">
        Nothing is sent from here. The text below is yours to copy — check it before you paste it
        anywhere, and remove anything you would not want public.
      </Notice>

      <TextAreaField
        id="report-description"
        label="What happened, and what did you expect instead?"
        hint="The steps that led to it are the most useful part."
        onChange={(event) => {
          setDescription(event.target.value);
          setCopyState("idle");
        }}
        value={description}
      />

      <TextAreaField
        id="report-text"
        label="The report"
        hint="Filled in for you. Edit it if something here should not leave your machine."
        readOnly
        rows={12}
        value={report}
      />

      {copyState === "copied" ? <Notice tone="success">Copied.</Notice> : null}
      {copyState === "manual" ? (
        <Notice tone="neutral">
          This browser will not let a page write to the clipboard over an insecure connection.
          Select the text above and press Ctrl+C.
        </Notice>
      ) : null}

      <div className={formStyles["actions"]}>
        <button
          className={formStyles["button"]}
          onClick={() => {
            void handleCopy();
          }}
          type="button"
        >
          Copy the report
        </button>

        {issueTrackerUrl === undefined ? null : (
          <a
            className={`${formStyles["button"]} ${formStyles["secondary"]}`}
            href={issueTrackerUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open the issue tracker
          </a>
        )}

        <button
          className={`${formStyles["button"]} ${formStyles["secondary"]}`}
          onClick={() => {
            setIsOpen(false);
            setCopyState("idle");
          }}
          type="button"
        >
          Close
        </button>
      </div>

      <p className={styles["reportHint"]}>
        A screenshot helps more than any of this. Take one with your operating system's screenshot
        key and paste it straight into the issue — the tracker accepts a pasted image, so it never
        has to touch this instance.
      </p>
    </section>
  );
}

interface ReportInput {
  readonly description: string;
  readonly version: string;
}

/**
 * The details a maintainer otherwise has to ask for, one exchange at a time.
 *
 * Deliberately excludes who is signed in. The person's email is not needed to
 * reproduce a bug, and a report is something they may paste in public.
 */
function composeReport({ description, version }: ReportInput): string {
  const lines = [
    "## What happened",
    description.trim() === "" ? "(describe it here)" : description.trim(),
    "",
    "## Environment",
    `Mifluent version: ${version}`,
    `Page: ${window.location.pathname}`,
    `Browser: ${navigator.userAgent}`,
    `Window: ${window.innerWidth}x${window.innerHeight}`,
    `Time (UTC): ${new Date().toISOString()}`,
  ];

  return lines.join("\n");
}
