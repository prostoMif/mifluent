/**
 * The half of this package that a browser may import.
 *
 * Everything re-exported here is pure: validation rules, constants and
 * functions that compute rather than query. Nothing in this file's import tree
 * reaches `@mifluent/db`.
 *
 * That boundary exists for a concrete reason. A sign-in form needs the same
 * password rule the server enforces, and importing it from the package's main
 * entry point pulls in the module graph behind it — which ends at the
 * PostgreSQL driver, and then at `fs` and `net`, in a file meant to run in a
 * browser. The build fails, and the fix people reach for is to duplicate the
 * rule in the form, which is exactly the drift this package was meant to stop.
 *
 * So: client components import from `@mifluent/domain/schemas`. Server code
 * imports from `@mifluent/domain`. Types may come from either — they are erased
 * before anything is bundled.
 */

export {
  type TopicInput,
  topicInputSchema,
  WATCH_TARGET_KINDS,
  type WatchProfileInput,
  type WatchTargetInput,
  type WatchTargetKind,
  watchProfileInputSchema,
  watchTargetInputSchema,
} from "./profiles/schemas.js";
export {
  areSnapshotsEqual,
  type SelectionSnapshot,
  serialiseSnapshot,
} from "./profiles/snapshot.js";
export type {
  WatchProfileDetail,
  WatchProfileSummary,
  WatchProfileTarget,
  WatchProfileTopic,
} from "./profiles/types.js";
export {
  AVAILABLE_SOURCE_KINDS,
  type AvailableSourceKind,
  DEFAULT_POLL_INTERVAL_MINUTES,
  type SourceInput,
  type SourceStatus,
  type SourceSummary,
  sourceInputSchema,
} from "./sources/schemas.js";
export {
  displayNameSchema,
  emailSchema,
  MAXIMUM_NAME_LENGTH,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  passwordSchema,
  type SignInInput,
  type SignUpInput,
  signInSchema,
  signUpSchema,
} from "./tenancy/credentials.js";
export type { Invitation, InvitationState } from "./tenancy/invitation-types.js";
export {
  assertRegistrationAllowed,
  type RegistrationRules,
} from "./tenancy/registration-rules.js";
export {
  can,
  isMemberRole,
  MEMBER_ROLES,
  type MemberRole,
  type Permission,
  requirePermission,
} from "./tenancy/roles.js";
export {
  isKnownTimezone,
  type TenantSettingsInput,
  tenantNameSchema,
  tenantSettingsSchema,
  timezoneSchema,
} from "./tenancy/tenant-schemas.js";
