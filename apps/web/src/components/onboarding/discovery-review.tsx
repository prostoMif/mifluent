"use client";

/**
 * "Here is what I understood."
 *
 * The business's facts, editable; every proposed target with its reason and a
 * checkbox; under each, every place it will be read from, verified or not.
 * A person can add a competitor the model missed — name and site; where to
 * watch it is found during the first run.
 *
 * "Continue" works whatever state the page is in. Checking every box is not
 * a task; the defaults are sensible and the profile can be edited later.
 */

import type { DiscoveryResult, Surface } from "@mifluent/discovery";
import {
  getCountry,
  getCountryName,
  getFlagEmoji,
  getMarket,
} from "@mifluent/domain/geo/countries";
import {
  type ProfileFromDiscoveryInput,
  profileFromDiscoverySchema,
} from "@mifluent/domain/schemas";
import { type FormEvent, useState } from "react";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";
import styles from "./onboarding.module.css";

interface SurfaceRow extends Surface {
  readonly key: string;
  isSelected: boolean;
}

interface TargetRow {
  readonly key: string;
  readonly kind: "competitor" | "platform" | "condition" | "self";
  readonly name: string;
  readonly websiteUrl: string | null;
  readonly reason: string | null;
  readonly isManual: boolean;
  isSelected: boolean;
  surfaces: SurfaceRow[];
}

export interface DiscoveryReviewProps {
  readonly result: DiscoveryResult;
  readonly input: string;
  readonly language: "en" | "ru";
  readonly targetsLeft: number;
  readonly onSaved: (profileId: string, runId: string) => void;
}

const KIND_LABELS: Readonly<Record<TargetRow["kind"], string>> = {
  competitor: "Competitor",
  platform: "Platform you depend on",
  condition: "Market condition",
  self: "Your brand",
};

const MONETIZATION = ["free", "trial", "subscription", "one_time", "unknown"] as const;

const COMMON_COUNTRIES_RU = [
  "RU",
  "US",
  "DE",
  "GB",
  "KZ",
  "BY",
  "UZ",
  "KG",
  "GE",
  "AM",
  "AZ",
  "MD",
];
const COMMON_COUNTRIES_EN = [
  "US",
  "GB",
  "DE",
  "CA",
  "AU",
  "FR",
  "ES",
  "IT",
  "NL",
  "PL",
  "RU",
  "KZ",
];

function getCommonCountries(language: "en" | "ru"): string[] {
  return language === "ru" ? COMMON_COUNTRIES_RU : COMMON_COUNTRIES_EN;
}

function countryOption(code: string, language: "en" | "ru"): { value: string; label: string } {
  const country = getCountry(code);
  const name = country ? getCountryName(code, language) : code;
  const flag = getFlagEmoji(code);
  return { value: code, label: `${flag} ${name}` };
}

interface GeographyFieldProps {
  label: string;
  name: string;
  extraName: string;
  value: string;
  extraValue: string[];
  language: "en" | "ru";
  detectConfidence: "high" | "low";
  required?: boolean;
}

function GeographyField({
  label,
  name,
  extraName,
  value,
  extraValue,
  language,
  detectConfidence,
  required,
}: GeographyFieldProps) {
  const commonCountries = getCommonCountries(language);
  const [mainCountry, setMainCountry] = useState(value);
  const [extraCountries, setExtraCountries] = useState(extraValue);
  const [showExtra, setShowExtra] = useState(extraValue.length > 0);

  const handleMainChange = (code: string) => {
    setMainCountry(code);
  };

  const handleExtraChange = (countries: string[]) => {
    setExtraCountries(countries.slice(0, 5));
  };

  const handleAddExtra = () => {
    setShowExtra(true);
  };

  const handleRemoveExtra = (code: string) => {
    setExtraCountries(extraCountries.filter((c) => c !== code));
  };

  const mainOptions = commonCountries.map((code) => countryOption(code, language));
  const extraOptions = commonCountries
    .filter((code) => code !== mainCountry)
    .map((code) => countryOption(code, language));

  return (
    <div className={formStyles["field"]}>
      <label className={formStyles["label"]} htmlFor={name}>
        {label} {required && <span className={formStyles["required"]}>*</span>}
        {detectConfidence === "low" && (
          <span className={styles["lowConfidence"]}> — проверьте</span>
        )}
      </label>
      <select
        className={formStyles["control"]}
        id={name}
        name={name}
        value={mainCountry}
        onChange={(e) => handleMainChange(e.target.value)}
        required={required}
      >
        <option value="">— выберите страну —</option>
        {mainOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {showExtra && (
        <div className={styles["extraCountries"]}>
          <label className={formStyles["label"]} htmlFor={extraName}>
            Дополнительные страны (до 5)
          </label>
          <div className={styles["chips"]}>
            {extraCountries.map((code) => {
              const opt = countryOption(code, language);
              return (
                <span key={code} className={styles["chip"]}>
                  {opt.label}
                  <button
                    type="button"
                    className={styles["chipRemove"]}
                    onClick={() => handleRemoveExtra(code)}
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
                id={extraName}
                name={extraName}
                onChange={(e) => {
                  const code = e.target.value;
                  if (code && !extraCountries.includes(code)) {
                    handleExtraChange([...extraCountries, code]);
                  }
                  e.target.value = "";
                }}
              >
                <option value="">+ добавить страну</option>
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

      {!showExtra && extraCountries.length === 0 && (
        <button
          type="button"
          className={`${formStyles["button"]} ${formStyles["secondary"]}`}
          onClick={handleAddExtra}
        >
          + добавить страну
        </button>
      )}

      <input type="hidden" name={extraName} value={extraCountries.join(",")} />
    </div>
  );
}

interface HomeCountryFieldProps {
  name: string;
  regionName: string;
  value: string;
  regionValue: string;
  mainCountry: string;
  language: "en" | "ru";
}

function HomeCountryField({
  name,
  regionName,
  value,
  regionValue,
  mainCountry,
  language,
}: HomeCountryFieldProps) {
  const commonCountries = getCommonCountries(language);
  const [homeCountry, setHomeCountry] = useState(value || mainCountry);
  const [region, setRegion] = useState(regionValue);
  const [sameAsMain, setSameAsMain] = useState(!value || value === mainCountry);

  const handleCountryChange = (code: string) => {
    setHomeCountry(code);
    setSameAsMain(code === mainCountry);
  };

  const handleSameAsMain = () => {
    setHomeCountry(mainCountry);
    setSameAsMain(true);
    setRegion("");
  };

  const mainOptions = commonCountries.map((code) => countryOption(code, language));

  // Get regions for the selected home country
  const countryData = getCountry(homeCountry);
  const regions = countryData?.regions ?? [];

  return (
    <div className={formStyles["field"]}>
      <label className={formStyles["label"]} htmlFor={name}>
        Where do you live / where is the business registered?
      </label>
      <div className={styles["homeCountryRow"]}>
        <select
          className={formStyles["control"]}
          id={name}
          name={name}
          value={homeCountry}
          onChange={(e) => handleCountryChange(e.target.value)}
        >
          <option value="">— выберите страну —</option>
          {mainOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {mainCountry && (
          <button
            type="button"
            className={`${formStyles["button"]} ${formStyles["secondary"]} ${styles["sameButton"]}`}
            onClick={handleSameAsMain}
            disabled={sameAsMain}
          >
            Same as "Where you sell" ({getFlagEmoji(mainCountry)}{" "}
            {getCountryName(mainCountry, language)})
          </button>
        )}
      </div>

      {regions.length > 0 && (
        <div className={formStyles["field"]}>
          <label className={formStyles["label"]} htmlFor={regionName}>
            Region (optional)
          </label>
          <select
            className={formStyles["control"]}
            id={regionName}
            name={regionName}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="">— регион не выбран —</option>
            {regions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function DiscoveryReview({
  result,
  input,
  language,
  targetsLeft,
  onSaved,
}: DiscoveryReviewProps) {
  const [targets, setTargets] = useState<TargetRow[]>(() => toRows(result, targetsLeft));
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  const selectedCount = targets.filter((target) => target.isSelected).length;

  function update(key: string, change: (row: TargetRow) => TargetRow): void {
    setTargets((rows) => rows.map((row) => (row.key === key ? change(row) : row)));
  }

  function addCompetitor(name: string, websiteUrl: string): void {
    setTargets((rows) => [
      ...rows,
      {
        key: `manual-${rows.length}`,
        kind: "competitor",
        name,
        websiteUrl,
        reason: null,
        isManual: true,
        isSelected: true,
        surfaces: [],
      },
    ]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = profileFromDiscoverySchema.safeParse(
      buildInput(form, { result, input, language, targets }),
    );

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Something here could not be saved.");
      return;
    }

    // Include browser timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const payload = { ...parsed.data, timezone };

    setIsPending(true);
    setError(undefined);
    try {
      const saved = await sendRequest<{ profileId: string; runId: string }>({
        method: "POST",
        path: "/api/watch-profiles/from-discovery",
        body: payload,
      });
      onSaved(saved.profileId, saved.runId);
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setIsPending(false);
    }
  }

  return (
    <form className={formStyles["form"]} noValidate onSubmit={handleSubmit}>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}

      <section className={styles["stage"]}>
        <h2>The business</h2>
        <div className={styles["facts"]}>
          <TextField
            defaultValue={result.business.name}
            id="review-name"
            label="Name"
            name="name"
            required
          />
          <div className={formStyles["field"]}>
            <label className={formStyles["label"]} htmlFor="review-monetization">
              How it earns
            </label>
            <select
              className={formStyles["control"]}
              defaultValue={result.business.monetization}
              id="review-monetization"
              name="monetization"
            >
              {MONETIZATION.map((value) => (
                <option key={value} value={value}>
                  {value.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <TextField
            defaultValue={result.business.platforms.join(", ")}
            hint="Comma-separated"
            id="review-platforms"
            label="Platforms it runs on"
            name="platforms"
          />
          <GeographyField
            label="Where do you sell?"
            name="country"
            extraName="extraCountries"
            value={result.business.country ?? result.business.countries[0] ?? ""}
            extraValue={result.business.extraCountries ?? result.business.countries.slice(1) ?? []}
            language={language}
            detectConfidence={result.business.country ? "high" : "low"}
            required
          />
          <HomeCountryField
            name="homeCountry"
            regionName="region"
            value={result.business.homeCountry ?? ""}
            regionValue={result.business.region ?? ""}
            mainCountry={result.business.country ?? result.business.countries[0] ?? ""}
            language={language}
          />
          <TextField
            defaultValue={result.business.customerType}
            id="review-customer"
            label="Customers"
            name="customerType"
          />
          <TextField
            hint="Optional: the thing you most want to hear about"
            id="review-matters"
            label="What matters most"
            name="whatMatters"
          />
        </div>
        <div className={formStyles["field"]}>
          <label className={formStyles["label"]} htmlFor="review-description">
            What it does
          </label>
          <textarea
            className={formStyles["control"]}
            defaultValue={result.business.description}
            id="review-description"
            name="description"
          />
        </div>
      </section>

      <section className={styles["stage"]}>
        <h2>What to watch</h2>
        <p className={formStyles["hint"]}>
          {selectedCount} selected. Your plan allows {targetsLeft} more. ✓ means the address
          answered when checked; ✗ means it did not, and will be tried anyway if you keep it.
        </p>
        <ul className={styles["targets"]}>
          {targets.map((target) => (
            <TargetItem
              key={target.key}
              onChange={(change) => update(target.key, change)}
              target={target}
            />
          ))}
        </ul>
      </section>

      <AddCompetitor onAdd={addCompetitor} />

      <div className={formStyles["actions"]}>
        <SubmitButton isPending={isPending} label="Continue" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

function TargetItem({
  target,
  onChange,
}: {
  readonly target: TargetRow;
  readonly onChange: (change: (row: TargetRow) => TargetRow) => void;
}) {
  const id = `target-${target.key}`;

  return (
    <li className={`${styles["target"]} ${target.isSelected ? "" : styles["targetMuted"]}`}>
      <label className={styles["checkRow"]} htmlFor={id}>
        <input
          checked={target.isSelected}
          id={id}
          onChange={(event) => {
            const isSelected = event.target.checked;
            onChange((row) => ({ ...row, isSelected }));
          }}
          type="checkbox"
        />
        <span>
          <span className={styles["targetName"]}>{target.name}</span>{" "}
          <span className={styles["kind"]}>{KIND_LABELS[target.kind]}</span>
          {target.reason === null ? null : (
            <span className={styles["reason"]}> — {target.reason}</span>
          )}
        </span>
      </label>

      {target.isManual ? (
        <p className={styles["reason"]}>Where to watch it will be found when you continue.</p>
      ) : (
        <ul className={styles["surfaces"]}>
          {target.surfaces.map((surface) => (
            <li key={surface.key}>
              <label className={styles["checkRow"]}>
                <input
                  checked={surface.isSelected}
                  disabled={!target.isSelected}
                  onChange={(event) => {
                    const isSelected = event.target.checked;
                    onChange((row) => ({
                      ...row,
                      surfaces: row.surfaces.map((item) =>
                        item.key === surface.key ? { ...item, isSelected } : item,
                      ),
                    }));
                  }}
                  type="checkbox"
                />
                <span>
                  <span className={surface.verified ? styles["verified"] : styles["unverified"]}>
                    {surface.verified ? "✓" : "✗"}
                  </span>{" "}
                  {surface.label} <span className={styles["surfaceUrl"]}>{surface.url}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AddCompetitor({ onAdd }: { readonly onAdd: (name: string, websiteUrl: string) => void }) {
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  function add(): void {
    const websiteUrl = /^https?:\/\//i.test(site.trim()) ? site.trim() : `https://${site.trim()}`;
    if (name.trim() === "" || !isWebAddress(websiteUrl)) {
      setError("Enter a name and the competitor's website.");
      return;
    }
    onAdd(name.trim(), websiteUrl);
    setName("");
    setSite("");
    setError(undefined);
  }

  return (
    <section className={styles["stage"]}>
      <h2>Who else do you consider a competitor?</h2>
      <div className={styles["facts"]}>
        <TextField
          id="add-name"
          label="Name"
          onChange={(event) => {
            setName(event.target.value);
          }}
          value={name}
        />
        <TextField
          error={error}
          id="add-site"
          inputMode="url"
          label="Website"
          onChange={(event) => {
            setSite(event.target.value);
          }}
          value={site}
        />
      </div>
      <div className={formStyles["actions"]}>
        <button
          className={`${formStyles["button"]} ${formStyles["secondary"]}`}
          onClick={add}
          type="button"
        >
          Add competitor
        </button>
      </div>
    </section>
  );
}

function toRows(result: DiscoveryResult, targetsLeft: number): TargetRow[] {
  const proposed = [
    ...result.targets,
    ...result.conditions.map((condition) => ({
      ...condition,
      kind: "condition" as const,
      websiteUrl: null,
    })),
  ];

  return proposed.map((target, index) => ({
    key: `proposed-${index}`,
    kind: target.kind,
    name: target.name,
    websiteUrl: target.websiteUrl,
    reason: target.reason,
    isManual: false,
    // Pre-select as many as the plan allows, in the order the model ranked them.
    isSelected: index < targetsLeft,
    surfaces: target.surfaces.map((surface, surfaceIndex) => ({
      ...surface,
      key: `proposed-${index}-${surfaceIndex}`,
      isSelected: surface.verified,
    })),
  }));
}

interface BuildContext {
  readonly result: DiscoveryResult;
  readonly input: string;
  readonly language: "en" | "ru";
  readonly targets: readonly TargetRow[];
}

function buildInput(
  form: FormData,
  context: BuildContext,
): ProfileFromDiscoveryInput | Record<string, unknown> {
  const text = (name: string): string => String(form.get(name) ?? "").trim();
  const list = (name: string): string[] =>
    text(name)
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");

  const country = text("country");
  const extraCountries = list("extraCountries");
  const homeCountry = text("homeCountry");
  const region = text("region");

  return {
    name: text("name"),
    businessDescription: text("description") === "" ? null : text("description"),
    websiteUrl: isWebAddress(context.input) ? context.input : null,
    facts: {
      monetization: text("monetization"),
      platforms: list("platforms"),
      countries: country ? [country, ...extraCountries] : list("countries"),
      country: country || undefined,
      extraCountries: extraCountries.length > 0 ? extraCountries : undefined,
      homeCountry: homeCountry || undefined,
      region: region || undefined,
      market: country ? getMarket(country) : undefined,
      customerType: text("customerType"),
      whatMatters: text("whatMatters"),
      language: context.language,
    },
    targets: context.targets
      .filter((target) => target.isSelected)
      .map((target) => ({
        kind: target.kind,
        name: target.name,
        websiteUrl: target.websiteUrl,
        reason: target.reason,
        surfaces: target.surfaces
          .filter((surface) => surface.isSelected)
          .map(({ type, url, label, pollIntervalMinutes }) => ({
            type,
            url,
            label,
            pollIntervalMinutes,
          })),
      })),
  };
}

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    // Not an address — the input was a sentence about the business.
    return false;
  }
}
