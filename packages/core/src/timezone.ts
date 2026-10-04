/**
 * Whether a string names a time zone this runtime knows.
 *
 * Lives in core because both the domain layer (saving a profile) and the
 * digest layer (scheduling it) need it, and neither may depend on the other.
 */
export function isKnownZone(zone: string | undefined): zone is string {
  if (zone === undefined || zone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    // An unknown zone is an ordinary "no", not an error: the caller falls
    // back to the instance default.
    return false;
  }
}
