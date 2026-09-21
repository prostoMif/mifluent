"use client";

import {
  DEFAULT_POLL_INTERVAL_MINUTES,
  type SourceSummary,
  sourceInputSchema,
} from "@mifluent/domain/schemas";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "@/components/profiles/profiles.module.css";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import { type FieldErrors, toFieldErrors } from "@/lib/field-errors";

export interface SourcesPanelProps {
  readonly profileId: string;
  readonly sources: readonly SourceSummary[];
  readonly canEdit: boolean;
}

export function SourcesPanel({ profileId, sources, canEdit }: SourcesPanelProps) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const form = event.currentTarget;
    const values = new FormData(form);
    const parsed = sourceInputSchema.safeParse({
      kind: "rss",
      label: values.get("label"),
      locator: values.get("locator"),
      pollIntervalMinutes: values.get("pollIntervalMinutes"),
    });

    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      setError(undefined);
      return;
    }

    setFieldErrors({});
    setError(undefined);
    setIsPending(true);

    try {
      await sendRequest({
        method: "POST",
        path: `/api/watch-profiles/${profileId}/sources`,
        body: parsed.data,
      });

      form.reset();
      router.refresh();
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    } finally {
      setIsPending(false);
    }
  }

  async function handleRemove(sourceId: string): Promise<void> {
    setError(undefined);

    try {
      await sendRequest({
        method: "DELETE",
        path: `/api/watch-profiles/${profileId}/sources/${sourceId}`,
      });
      router.refresh();
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    }
  }

  return (
    <section aria-labelledby="sources-heading" className={styles["section"]}>
      <h2 className={styles["sectionTitle"]} id="sources-heading">
        Where to read from
      </h2>
      <p className={styles["sectionHint"]}>
        Feed addresses. Most blogs and news sites have one — look for a link called RSS, Atom or
        Feed, or try adding <code>/feed</code> to the address.
      </p>

      {error === undefined ? null : <Notice tone="error">{error}</Notice>}

      {sources.length === 0 ? (
        <p className={styles["sectionHint"]}>Nothing is being read yet.</p>
      ) : (
        <ul className={styles["profileList"]}>
          {sources.map((source) => (
            <li className={styles["profileCard"]} key={source.id}>
              <strong>{source.label}</strong>
              <p className={styles["profileMeta"]}>{describe(source)}</p>

              {source.lastErrorMessage === null ? null : (
                <p className={styles["profileMeta"]}>Last error: {source.lastErrorMessage}</p>
              )}

              {canEdit ? (
                <button
                  className={styles["removeButton"]}
                  onClick={() => {
                    void handleRemove(source.id);
                  }}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form className={formStyles["form"]} onSubmit={handleAdd} noValidate>
          <TextField
            id="source-label"
            name="label"
            label="What to call it"
            required
            error={fieldErrors["label"]}
          />

          <TextField
            id="source-locator"
            name="locator"
            type="url"
            inputMode="url"
            label="Feed address"
            hint="For example https://example.com/feed.xml"
            required
            error={fieldErrors["locator"]}
          />

          <TextField
            id="source-interval"
            name="pollIntervalMinutes"
            type="number"
            label="Check every, minutes"
            defaultValue={DEFAULT_POLL_INTERVAL_MINUTES}
            min={10}
            hint="A changelog is not a news feed. Checking more often than every ten minutes is not allowed — it is rude, and it gets the instance blocked."
            error={fieldErrors["pollIntervalMinutes"]}
          />

          <div className={formStyles["actions"]}>
            <SubmitButton isPending={isPending} label="Add source" pendingLabel="Adding…" />
          </div>
        </form>
      ) : null}
    </section>
  );
}

/**
 * One line about a source's health.
 *
 * A source that has never succeeded reads differently from one that stopped
 * yesterday, and "broken" has to be visible without opening anything: the whole
 * failure mode this product has to avoid is a quiet week that was really an
 * outage.
 */
function describe(source: SourceSummary): string {
  const parts: string[] = [`${source.itemCount} item(s)`];

  if (source.status === "broken") {
    parts.push("stopped after repeated failures");
  } else if (source.lastSucceededAt === null) {
    parts.push("never read successfully yet");
  } else {
    parts.push(`last read ${source.lastSucceededAt.toLocaleString()}`);
  }

  parts.push(`every ${source.pollIntervalMinutes} min`);

  return parts.join(" · ");
}
