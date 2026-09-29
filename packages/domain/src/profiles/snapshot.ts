/**
 * What a profile version actually records.
 *
 * The rule from the schema notes: a new version is created only by a change
 * that affects **selection**. Renaming a profile or moving the delivery time
 * must not create one, or the version number stops meaning anything and the
 * question "why did this appear in Tuesday's digest" becomes unanswerable
 * again.
 *
 * Rather than keeping a list of which fields count, the snapshot *is* the
 * definition: a field is selection-affecting exactly when it appears below.
 * That way the rule cannot drift away from the code that enforces it.
 *
 * Comparison is done on a canonical string. Two snapshots holding the same
 * topics in a different order are the same snapshot — the collector does not
 * care what order they came out of the database in, and treating that as a
 * change would produce a new version on every save.
 */

export interface SnapshotTopic {
  readonly label: string;
  readonly description: string | null;
}

export interface SnapshotTarget {
  readonly kind: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export interface SnapshotFacts {
  readonly monetization?: "free" | "trial" | "subscription" | "one_time" | "unknown";
  readonly platforms?: readonly string[];
  /** @deprecated Use country + extraCountries. Kept for migration of old profiles. */
  readonly countries?: readonly string[];
  /** ISO 3166-1 alpha-2 code of the primary country the business sells in. */
  readonly country?: string;
  /** Up to 5 additional countries the business sells in (ISO alpha-2). */
  readonly extraCountries?: readonly string[];
  /** ISO 3166-2 region code (e.g., "MOW" for Moscow, "CA" for California). Optional. */
  readonly region?: string;
  /** ISO 3166-1 alpha-2 code of the country where the person/business is based (tax, legal). */
  readonly homeCountry?: string;
  /** Computed market: "ru" for RU/BY/KZ/UZ/KG/AM, "en" otherwise. */
  readonly market?: "ru" | "en";
  readonly customerType?: string;
  readonly whatMatters?: string;
  readonly language?: "en" | "ru";
}

export interface SelectionSnapshot {
  readonly businessDescription: string | null;
  readonly relevanceThreshold: number;
  readonly topics: readonly SnapshotTopic[];
  readonly targets: readonly SnapshotTarget[];
  readonly stopwords: readonly string[];
  readonly facts: SnapshotFacts | null;
}

/**
 * A stable string for one snapshot.
 *
 * `JSON.stringify` on the raw object would not do: key order follows insertion
 * order, and a row read back from the database can arrive with its columns in
 * a different order than the object that was written.
 */
export function serialiseSnapshot(snapshot: SelectionSnapshot): string {
  const canonical = {
    businessDescription: snapshot.businessDescription ?? "",
    relevanceThreshold: snapshot.relevanceThreshold,
    topics: [...snapshot.topics]
      .map((topic) => [topic.label, topic.description ?? ""])
      .sort(compareRows),
    targets: [...snapshot.targets]
      .map((target) => [target.kind, target.name, [...target.aliases].sort().join("")])
      .sort(compareRows),
    stopwords: [...snapshot.stopwords].sort(),
    facts: snapshot.facts
      ? {
          monetization: snapshot.facts.monetization ?? "",
          platforms: [...(snapshot.facts.platforms ?? [])].sort(),
          countries: [...(snapshot.facts.countries ?? [])].sort(),
          country: snapshot.facts.country ?? "",
          extraCountries: [...(snapshot.facts.extraCountries ?? [])].sort(),
          region: snapshot.facts.region ?? "",
          homeCountry: snapshot.facts.homeCountry ?? "",
          market: snapshot.facts.market ?? "",
          customerType: snapshot.facts.customerType ?? "",
          whatMatters: snapshot.facts.whatMatters ?? "",
          language: snapshot.facts.language ?? "",
        }
      : null,
  };

  return JSON.stringify(canonical);
}

export function areSnapshotsEqual(left: SelectionSnapshot, right: SelectionSnapshot): boolean {
  return serialiseSnapshot(left) === serialiseSnapshot(right);
}

/**
 * Returns true if the geography fields that affect source selection have changed.
 * Used by TASK-033 to trigger source set rebuild.
 */
export function geographyChanged(
  prev: SelectionSnapshot["facts"],
  next: SelectionSnapshot["facts"],
): boolean {
  if (!prev && !next) return false;
  if (!prev || !next) return true;

  const prevCountry = prev.country ?? prev.countries?.[0] ?? "";
  const nextCountry = next.country ?? next.countries?.[0] ?? "";
  const prevHomeCountry = prev.homeCountry ?? prevCountry;
  const nextHomeCountry = next.homeCountry ?? nextCountry;
  const prevExtra = [...(prev.extraCountries ?? [])].sort().join(",");
  const nextExtra = [...(next.extraCountries ?? [])].sort().join(",");

  return (
    prevCountry !== nextCountry ||
    prevHomeCountry !== nextHomeCountry ||
    prevExtra !== nextExtra ||
    (prev.region ?? "") !== (next.region ?? "")
  );
}

/** Lexicographic order over the whole row, so sorting is total and stable. */
function compareRows(left: readonly string[], right: readonly string[]): number {
  return left.join("").localeCompare(right.join(""));
}
