/**
 * The service tenant that owns every source pack's sources, and its one
 * profile.
 *
 * Fixed identifiers rather than configuration: every instance — the cloud, a
 * self-hosted box, a test database — gets the same rows from `packs:sync`, and
 * nothing has to be copied into `.env` for packs to work. Version 7 UUIDs with
 * a zero timestamp, so they sort before every real row and stand out in a
 * query result.
 */
export const PACKS_TENANT_ID = "00000000-0000-7000-8000-00000000ac01";
export const PACKS_PROFILE_ID = "00000000-0000-7000-8000-00000000ac02";
