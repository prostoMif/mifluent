"use client";

/**
 * The billing part of Settings: what the account is on, until when, and the
 * no-questions refund within fourteen days of paying.
 */

import { useState } from "react";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";

export interface BillingPanelProps {
  readonly effectivePlan: string;
  readonly paidPlan: string;
  readonly trialEndsAt: string | null;
  readonly paidUntil: string | null;
  readonly isRefundPossible: boolean;
}

export function BillingPanel(props: BillingPanelProps) {
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const isTrial = props.paidPlan === "free" && props.effectivePlan === "pro";

  async function askForRefund(): Promise<void> {
    setState("pending");
    setError(null);
    try {
      await sendRequest({ method: "POST", path: "/api/billing/refund" });
      setState("sent");
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setState("idle");
    }
  }

  return (
    <section aria-labelledby="billing-heading">
      <h2 id="billing-heading">Plan</h2>
      <dl>
        <dt>Current plan</dt>
        <dd>
          {props.effectivePlan}
          {isTrial && props.trialEndsAt !== null
            ? ` — free trial until ${formatDate(props.trialEndsAt)}`
            : ""}
        </dd>
        {props.paidUntil === null ? null : (
          <>
            <dt>Paid until</dt>
            <dd>{formatDate(props.paidUntil)}</dd>
          </>
        )}
      </dl>
      <p>
        <a href="/pricing">Plans and prices</a>
      </p>

      {error === null ? null : <Notice tone="error">{error}</Notice>}
      {state === "sent" ? (
        <Notice tone="success">
          Refund requested. The money goes back to your card within a few days.
        </Notice>
      ) : null}
      {props.isRefundPossible && state !== "sent" ? (
        <button
          type="button"
          className={`${formStyles["button"]} ${formStyles["secondary"]}`}
          disabled={state === "pending"}
          onClick={() => void askForRefund()}
        >
          Refund my last payment
        </button>
      ) : null}
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
