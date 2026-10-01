"use client";

import { getCountry, getCountryName, getFlagEmoji } from "@mifluent/domain/geo/countries";
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
  self: "Your brand — mentions of your product",
};

const COMMON_COUNTRIES = [
  "RU",
  "US",
  "DE",
  "GB",
  "CA",
  "AU",
  "FR",
  "ES",
  "IT",
  "NL",
  "PL",
  "KZ",
  "BY",
  "UZ",
  "KG",
  "GE",
  "AM",
  "AZ",
  "MD",
];

function countryOption(code: string): { value: string; label: string } {
  const country = getCountry(code);
  const name = country ? getCountryName(code, "en") : code;
  const flag = getFlagEmoji(code);
  return { value: code, label: `${flag} ${name}` };
}

interface GeographyFieldsProps {
  profile: WatchProfileDetail | undefined;
  fieldErrors: FieldErrors;
  setFieldErrors: React.Dispatch<React.SetStateAction<FieldErrors>>;
}

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  required?: boolean;
}

function CountrySelect({ value, onChange, error, required }: CountrySelectProps) {
  const countryOptions = COMMON_COUNTRIES.map(countryOption);
  return (
    <div className={formStyles["field"]}>
      <label className={formStyles["label"]} htmlFor="profile-country">
        Where do you sell? {required && <span className={formStyles["required"]}>*</span>}
      </label>
      <select
        className={`${formStyles["control"]} ${error ? styles["invalid"] : ""}`}
        id="profile-country"
        name="country"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "profile-country-error" : undefined}
      >
        <option value="">— select country —</option>
        {countryOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <span className={styles["fieldError"]} id="profile-country-error">
          {error}
        </span>
      )}
    </div>
  );
}

interface ExtraCountriesProps {
  extraCountries: string[];
  onChange: (countries: string[]) => void;
  onRemove: (code: string) => void;
  onAdd: () => void;
  showExtra: boolean;
  mainCountry: string;
  error?: string | undefined;
}

function ExtraCountries({
  extraCountries,
  onChange,
  onRemove,
  onAdd,
  showExtra,
  mainCountry,
}: ExtraCountriesProps) {
  const extraOptions = COMMON_COUNTRIES.filter((code) => code !== mainCountry).map(countryOption);

  if (!showExtra && extraCountries.length === 0) {
    return (
      <button
        type="button"
        className={`${formStyles["button"]} ${formStyles["secondary"]}`}
        onClick={onAdd}
      >
        + add country
      </button>
    );
  }

  return (
    <>
      {showExtra && (
        <div className={formStyles["field"]}>
          <label className={formStyles["label"]} htmlFor="profile-extra-countries">
            Additional countries (up to 5)
          </label>
          <div className={styles["chips"]}>
            {extraCountries.map((code) => {
              const opt = countryOption(code);
              return (
                <span key={code} className={styles["chip"]}>
                  {opt.label}
                  <button
                    type="button"
                    className={styles["chipRemove"]}
                    onClick={() => onRemove(code)}
                    aria-label={`Remove ${opt.label}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {extraCountries.length < 5 && (
              <select
                className={formStyles["control"]}
                id="profile-extra-countries"
                name="extraCountries"
                onChange={(e) => {
                  const code = e.target.value;
                  if (code && !extraCountries.includes(code)) {
                    onChange([...extraCountries, code]);
                  }
                  e.target.value = "";
                }}
              >
                <option value="">+ add country</option>
                {extraOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
      <input type="hidden" name="extraCountries" value={extraCountries.join(",")} />
    </>
  );
}

interface HomeCountryProps {
  homeCountry: string;
  onChange: (value: string) => void;
  onSameAsMain: () => void;
  mainCountry: string;
  region: string;
  onRegionChange: (value: string) => void;
  error?: string | undefined;
  regionError?: string | undefined;
}

function HomeCountry({
  homeCountry,
  onChange,
  onSameAsMain,
  mainCountry,
  region,
  onRegionChange,
  error,
  regionError,
}: HomeCountryProps) {
  const homeCountryOptions = COMMON_COUNTRIES.map(countryOption);
  const countryData = getCountry(homeCountry);
  const regions = countryData?.regions ? [...countryData.regions] : [];

  return (
    <>
      <div className={formStyles["field"]}>
        <label className={formStyles["label"]} htmlFor="profile-home-country">
          Where do you live / where is the business registered?
        </label>
        <div className={styles["homeCountryRow"]}>
          <select
            className={`${formStyles["control"]} ${error ? styles["invalid"] : ""}`}
            id="profile-home-country"
            name="homeCountry"
            value={homeCountry}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "profile-home-country-error" : undefined}
          >
            <option value="">— select country —</option>
            {homeCountryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {error && (
            <span className={styles["fieldError"]} id="profile-home-country-error">
              {error}
            </span>
          )}
          {mainCountry && (
            <button
              type="button"
              className={`${formStyles["button"]} ${formStyles["secondary"]} ${styles["sameButton"]}`}
              onClick={onSameAsMain}
              disabled={homeCountry === mainCountry}
            >
              Same as "Where you sell" ({getFlagEmoji(mainCountry)}{" "}
              {getCountryName(mainCountry, "en")})
            </button>
          )}
        </div>
      </div>
      {regions.length > 0 && (
        <div className={formStyles["field"]}>
          <label className={formStyles["label"]} htmlFor="profile-region">
            Region (optional)
          </label>
          <select
            className={`${formStyles["control"]} ${regionError ? styles["invalid"] : ""}`}
            id="profile-region"
            name="region"
            value={region}
            onChange={(e) => onRegionChange(e.target.value)}
            aria-invalid={regionError ? true : undefined}
            aria-describedby={regionError ? "profile-region-error" : undefined}
          >
            <option value="">— region not selected —</option>
            {regions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {regionError && (
            <span className={styles["fieldError"]} id="profile-region-error">
              {regionError}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function GeographyFields({ profile, fieldErrors, setFieldErrors }: GeographyFieldsProps) {
  const facts = profile?.facts as
    | {
        country?: string;
        extraCountries?: string[];
        homeCountry?: string;
        region?: string;
      }
    | undefined;

  const [country, setCountry] = useState(facts?.country ?? "");
  const [extraCountries, setExtraCountries] = useState(facts?.extraCountries ?? []);
  const [homeCountry, setHomeCountry] = useState(facts?.homeCountry ?? facts?.country ?? "");
  const [region, setRegion] = useState(facts?.region ?? "");
  const [showExtra, setShowExtra] = useState<boolean>(
    Boolean(facts?.extraCountries && facts.extraCountries.length > 0),
  );

  const handleCountryChange = (value: string) => {
    setCountry(value);
    setFieldErrors((prev) => ({ ...prev, country: undefined }));
  };

  const handleExtraChange = (countries: string[]) => {
    setExtraCountries(countries.slice(0, 5));
    setFieldErrors((prev) => ({ ...prev, extraCountries: undefined }));
  };

  const handleHomeCountryChange = (value: string) => {
    setHomeCountry(value);
    setFieldErrors((prev) => ({ ...prev, homeCountry: undefined }));
  };

  const handleRegionChange = (value: string) => {
    setRegion(value);
    setFieldErrors((prev) => ({ ...prev, region: undefined }));
  };

  const handleSameAsMain = () => {
    setHomeCountry(country);
    setRegion("");
    setFieldErrors((prev) => ({ ...prev, homeCountry: undefined, region: undefined }));
  };

  const handleAddExtra = () => {
    setShowExtra(true);
  };

  const handleRemoveExtra = (code: string) => {
    setExtraCountries(extraCountries.filter((c) => c !== code));
  };

  return (
    <section aria-labelledby="geography-heading" className={styles["section"]}>
      <h2 className={styles["sectionTitle"]} id="geography-heading">
        Geography
      </h2>
      <p className={styles["sectionHint"]}>
        Where you sell determines which sources we check. Where you're based determines taxes and
        laws.
      </p>

      <CountrySelect
        value={country}
        onChange={handleCountryChange}
        error={fieldErrors["country"]}
        required
      />

      <ExtraCountries
        extraCountries={extraCountries}
        onChange={handleExtraChange}
        onRemove={handleRemoveExtra}
        onAdd={handleAddExtra}
        showExtra={showExtra}
        mainCountry={country}
        error={fieldErrors["extraCountries"]}
      />

      <HomeCountry
        homeCountry={homeCountry}
        onChange={handleHomeCountryChange}
        onSameAsMain={handleSameAsMain}
        mainCountry={country}
        region={region}
        onRegionChange={handleRegionChange}
        error={fieldErrors["homeCountry"]}
        regionError={fieldErrors["region"]}
      />
    </section>
  );
}

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
      country: form.get("country"),
      extraCountries: form.get("extraCountries")
        ? String(form.get("extraCountries"))
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v !== "")
        : undefined,
      homeCountry: form.get("homeCountry"),
      region: form.get("region"),
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

      <GeographyFields
        profile={profile}
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
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
