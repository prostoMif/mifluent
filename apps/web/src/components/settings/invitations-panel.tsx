"use client";

import { type Invitation, MEMBER_ROLES, type MemberRole } from "@mifluent/domain/schemas";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import styles from "./invitations.module.css";

export interface InvitationsPanelProps {
  readonly invitations: readonly Invitation[];
}

interface CreatedInvitation {
  readonly email: string;
  /** Relative, so the browser can join it to whatever address it is using. */
  readonly invitePath: string;
}

const ROLE_LABELS: Readonly<Record<MemberRole, string>> = {
  owner: "Owner — can also manage people and keys",
  member: "Member — can read and edit what is watched",
};

export function InvitationsPanel({ invitations }: InvitationsPanelProps) {
  const router = useRouter();
  const [created, setCreated] = useState<CreatedInvitation | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const role = String(form.get("role") ?? "member");

    setError(undefined);
    setCreated(undefined);
    setCopyState("idle");
    setIsPending(true);

    try {
      const result = await sendRequest<CreatedInvitation>({
        method: "POST",
        path: "/api/invitations",
        body: { email, role },
      });

      setCreated(result);
      router.refresh();
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    } finally {
      setIsPending(false);
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    setError(undefined);

    try {
      await sendRequest({ method: "DELETE", path: `/api/invitations/${id}` });
      router.refresh();
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    }
  }

  async function handleCopy(link: string): Promise<void> {
    // `navigator.clipboard` only exists in a secure context, and an instance on
    // plain http over a local network is not one.
    if (navigator.clipboard === undefined) {
      setCopyState("manual");
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }

  const pending = invitations.filter(
    (invitation) => invitation.acceptedAt === null && invitation.revokedAt === null,
  );

  return (
    <section aria-labelledby="invitations-heading">
      <h2 id="invitations-heading">Invitations</h2>

      <p className={styles["explainer"]}>
        Sign-up is closed, so this is how somebody else gets in. You get a link to send them however
        you like — the instance does not need a mail server for it. Each link works once, for that
        address only, and stops working after a week.
      </p>

      {error === undefined ? null : <Notice tone="error">{error}</Notice>}

      {created === undefined ? null : (
        <CreatedLink created={created} copyState={copyState} onCopy={handleCopy} />
      )}

      <form className={formStyles["form"]} onSubmit={handleCreate}>
        <TextField
          id="invite-email"
          name="email"
          type="email"
          label="Their email"
          inputMode="email"
          required
        />

        <div className={formStyles["field"]}>
          <label className={formStyles["label"]} htmlFor="invite-role">
            What they may do
          </label>
          <select
            className={formStyles["control"]}
            defaultValue="member"
            id="invite-role"
            name="role"
          >
            {MEMBER_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>

        <div className={formStyles["actions"]}>
          <SubmitButton isPending={isPending} label="Create invitation" pendingLabel="Creating…" />
        </div>
      </form>

      {pending.length === 0 ? (
        <p className={styles["explainer"]}>No invitations are waiting to be used.</p>
      ) : (
        <ul className={styles["list"]}>
          {pending.map((invitation) => (
            <li className={styles["row"]} key={invitation.id}>
              <div>
                <strong>{invitation.email}</strong>
                <p className={styles["meta"]}>
                  {invitation.role} · expires {invitation.expiresAt.toLocaleDateString()}
                </p>
              </div>
              <button
                className={`${formStyles["button"]} ${formStyles["secondary"]}`}
                onClick={() => {
                  void handleRevoke(invitation.id);
                }}
                type="button"
              >
                Withdraw
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface CreatedLinkProps {
  readonly created: CreatedInvitation;
  readonly copyState: "idle" | "copied" | "manual";
  readonly onCopy: (link: string) => Promise<void>;
}

/**
 * The one moment the link exists.
 *
 * It is not stored in readable form, so closing this without copying it means
 * issuing a new invitation. The text says so, because discovering it later is
 * worse.
 */
function CreatedLink({ created, copyState, onCopy }: CreatedLinkProps) {
  const link = new URL(created.invitePath, window.location.origin).toString();

  return (
    <div className={styles["created"]}>
      <Notice tone="success">
        Invitation for <strong>{created.email}</strong> is ready. Copy the link now — it is not
        shown again, and it is not stored anywhere it could be read back.
      </Notice>

      <input className={formStyles["control"]} readOnly value={link} />

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
            void onCopy(link);
          }}
          type="button"
        >
          Copy the link
        </button>
      </div>
    </div>
  );
}
