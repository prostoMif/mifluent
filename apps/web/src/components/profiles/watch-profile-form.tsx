"use client";

import {
  WATCH_TARGET_KINDS,
  type WatchProfileDetail,
  type WatchTargetKind,
  watchProfileInputSchema,
} from "@mifluent/domain/schemas";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "@/components/profiles/profiles.module.css";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextAreaField } from "@/components/ui/text-area-field";
import { TextField } from "@/components/ui/text-field";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import { type FieldErrors, toFieldErrors } from "@/lib/field-errors";

interface TopicRow {
  readonly key: string;
  label: string;
  description: string;
}

interface TargetRow {
  readonly key: string;
  kind: WatchTargetKind;
  name: string;
  websiteUrl: string;
}

export interface WatchProfileFormProps {
  /** Absent when creating. */
  readonly profile?: WatchProfileDetail;
}

const KIND_LABELS: Readonly<Record<WatchTargetKind, string>> = {
  competitor: "Competitor — sells to the same people",
  platform: "Platform — something you depend on",
  condition: "Condition — tax, regulation, rates",
};

/**
 * Rows need a key that survives editing, and a row that has not been saved yet
 * has no identifier to use.
 *
 * A counter rather than `crypto.randomUUID()`: that function only exists in a
 * secure context, and a self-hosted instance reached over plain http on a local
 * network is not one. It would work on the maintainer's laptop and throw on
 * somebody's server.
 */
let nextRowKey = 0;

function newKey(): string {
  nextRowKey += 1;
  return `new-${nextRowKey}`;
}

export function WatchProfileForm({ profile }: WatchProfileFormProps) {
  const router = useRouter();

  const [topics, setTopics] = useState<TopicRow[]>(
    (profile?.topics ?? []).map((topic) => ({
      key: topic.id,
      label: topic.label,
      description: topic.description ?? "",
    })),
  );
  const [targets, setTargets] = useState<TargetRow[]>(
    (profile?.targets ?? []).map((target) => ({
      key: target.id,
      kind: target.kind,
      name: target.name,
      websiteUrl: target.websiteUrl ?? "",
    })),
  );
  const [threshold, setThreshold] = useState(profile?.relevanceThreshold ?? 0.5);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const parsed = watchProfileInputSchema.safeParse({
      name: form.get("name"),
      businessDescription: form.get("businessDescription"),
      websiteUrl: form.get("websiteUrl"),
      relevanceThreshold: threshold,
      changeReason: form.get("changeReason"),
      // Rows the person started and abandoned are dropped rather than refused.
      // An empty row is not a mistake to correct, it is a row they did not want.
      topics: topics
        .filter((topic) => topic.label.trim() !== "")
        .map((topic) => ({ label: topic.label, description: topic.description })),
      targets: targets
        .filter((target) => target.name.trim() !== "")
        .map((target) => ({
          kind: target.kind,
          name: target.name,
          websiteUrl: target.websiteUrl,
          aliases: [],
          reason: "",
        })),
      stopwords: splitLines(form.get("stopwords")),
    });

    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      setFormError("Some of this could not be saved. Check the fields marked below.");
      return;
    }

    setFieldErrors({});
    setFormError(undefined);
    setIsPending(true);

    try {
      const saved = await sendRequest<WatchProfileDetail>(
        profile === undefined
          ? { method: "POST", path: "/api/watch-profiles", body: parsed.data }
          : { method: "PATCH", path: `/api/watch-profiles/${profile.id}`, body: parsed.data },
      );

      router.push(`/watching/${saved.id}`);
      router.refresh();
    } catch (error) {
      setFormError(toDisplayMessage(error));
      setIsPending(false);
    }
  }

  return (
    <form className={formStyles["form"]} onSubmit={handleSubmit} noValidate>
      {formError === undefined ? null : <Notice tone="error">{formError}</Notice>}

      <TextField
        id="profile-name"
        name="name"
        label="Profile name"
        defaultValue={profile?.name ?? ""}
        hint="Only for your own reference, in case you watch more than one thing."
        required
        error={fieldErrors["name"]}
      />

      <TextAreaField
        id="profile-description"
        name="businessDescription"
        label="What does your business do?"
        defaultValue={profile?.businessDescription ?? ""}
        hint="Plain language, a paragraph is enough. This is what everything else is judged against, so it is worth writing properly."
        error={fieldErrors["businessDescription"]}
      />

      <TextField
        id="profile-website"
        name="websiteUrl"
        type="url"
        label="Your website"
        inputMode="url"
        defaultValue={profile?.websiteUrl ?? ""}
        hint="Optional. Used to work out what you do and who you compete with."
        error={fieldErrors["websiteUrl"]}
      />

      <section aria-labelledby="topics-heading" className={styles["section"]}>
        <h2 className={styles["sectionTitle"]} id="topics-heading">
          Topics
        </h2>
        <p className={styles["sectionHint"]}>
          Subjects worth waking up to. A description matches better than a bare word.
        </p>

        <div className={styles["rows"]}>
          {topics.map((topic, index) => (
            <div className={`${styles["row"]} ${styles["rowColumns"]}`} key={topic.key}>
              <TextField
                id={`topic-label-${topic.key}`}
                label="Topic"
                value={topic.label}
                onChange={(event) => {
                  setTopics(replaceAt(topics, index, { ...topic, label: event.target.value }));
                }}
              />
              <TextField
                id={`topic-description-${topic.key}`}
                label="In other words"
                value={topic.description}
                onChange={(event) => {
                  setTopics(
                    replaceAt(topics, index, { ...topic, description: event.target.value }),
                  );
                }}
              />
              <div className={styles["rowActions"]}>
                <button
                  className={styles["removeButton"]}
                  onClick={() => {
                    setTopics(removeAt(topics, index));
                  }}
                  type="button"
                >
                  Remove topic
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          className={`${formStyles["button"]} ${formStyles["secondary"]}`}
          onClick={() => {
            setTopics([...topics, { key: newKey(), label: "", description: "" }]);
          }}
          type="button"
        >
          Add a topic
        </button>
      </section>

      <section aria-labelledby="targets-heading" className={styles["section"]}>
        <h2 className={styles["sectionTitle"]} id="targets-heading">
          What to watch
        </h2>
        <p className={styles["sectionHint"]}>
          Competitors, the platforms you depend on, and the rules that apply to you. Not all three
          are competitors, which is why they are labelled.
        </p>

        <div className={styles["rows"]}>
          {targets.map((target, index) => (
            <div className={`${styles["row"]} ${styles["rowColumns"]}`} key={target.key}>
              <div className={formStyles["field"]}>
                <label className={formStyles["label"]} htmlFor={`target-kind-${target.key}`}>
                  Kind
                </label>
                <select
                  className={formStyles["control"]}
                  id={`target-kind-${target.key}`}
                  onChange={(event) => {
                    setTargets(
                      replaceAt(targets, index, { ...target, kind: readKind(event.target.value) }),
                    );
                  }}
                  value={target.kind}
                >
                  {WATCH_TARGET_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </div>

              <TextField
                id={`target-name-${target.key}`}
                label="Name"
                value={target.name}
                onChange={(event) => {
                  setTargets(replaceAt(targets, index, { ...target, name: event.target.value }));
                }}
              />

              <TextField
                id={`target-website-${target.key}`}
                label="Website"
                type="url"
                inputMode="url"
                value={target.websiteUrl}
                onChange={(event) => {
                  setTargets(
                    replaceAt(targets, index, { ...target, websiteUrl: event.target.value }),
                  );
                }}
              />

              <div className={styles["rowActions"]}>
                <button
                  className={styles["removeButton"]}
                  onClick={() => {
                    setTargets(removeAt(targets, index));
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          className={`${formStyles["button"]} ${formStyles["secondary"]}`}
          onClick={() => {
            setTargets([
              ...targets,
              { key: newKey(), kind: "competitor", name: "", websiteUrl: "" },
            ]);
          }}
          type="button"
        >
          Add something to watch
        </button>
      </section>

      <section aria-labelledby="tuning-heading" className={styles["section"]}>
        <h2 className={styles["sectionTitle"]} id="tuning-heading">
          Tuning
        </h2>

        <TextAreaField
          id="profile-stopwords"
          name="stopwords"
          label="Never show me"
          defaultValue={(profile?.stopwords ?? []).join("\n")}
          hint="One term per line. Anything mentioning them is dropped before it reaches you."
          error={fieldErrors["stopwords"]}
        />

        <div className={formStyles["field"]}>
          <label className={formStyles["label"]} htmlFor="profile-threshold">
            How strict to be
          </label>
          <span className={formStyles["hint"]} id="profile-threshold-hint">
            Lower shows you more and wastes more of your time. Higher shows you less and will
            eventually miss something. Start in the middle and move it after a week of real digests.
          </span>
          <div className={styles["thresholdRow"]}>
            <input
              aria-describedby="profile-threshold-hint"
              id="profile-threshold"
              max={1}
              min={0}
              onChange={(event) => {
                setThreshold(Number(event.target.value));
              }}
              step={0.05}
              type="range"
              value={threshold}
            />
            <output className={styles["thresholdValue"]} htmlFor="profile-threshold">
              {threshold.toFixed(2)}
            </output>
          </div>
        </div>

        <TextField
          id="profile-change-reason"
          name="changeReason"
          label="Why are you changing this?"
          hint="Optional. Saved next to this version, so a future you can tell why the digest changed."
          error={fieldErrors["changeReason"]}
        />
      </section>

      <div className={formStyles["actions"]}>
        <SubmitButton
          isPending={isPending}
          label={profile === undefined ? "Create profile" : "Save profile"}
          pendingLabel="Saving…"
        />
      </div>
    </form>
  );
}

function replaceAt<T>(rows: readonly T[], index: number, row: T): T[] {
  return rows.map((existing, position) => (position === index ? row : existing));
}

function removeAt<T>(rows: readonly T[], index: number): T[] {
  return rows.filter((_, position) => position !== index);
}

/** A `select` hands back a string; the schema wants one of three known values. */
function readKind(value: string): WatchTargetKind {
  const match = WATCH_TARGET_KINDS.find((kind) => kind === value);
  return match ?? "competitor";
}

function splitLines(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
