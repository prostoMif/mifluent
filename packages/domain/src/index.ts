/**
 * The server entry point.
 *
 * Re-exports everything, including the parts that talk to the database. A
 * browser bundle must not import this — see `schemas.ts`, which is the entry
 * point client components use, and which explains why the split exists.
 */

export type { OnboardingChannel, PendingOnboarding } from "@mifluent/db/schema";
export {
  type CardActionInput,
  type CardOwner,
  type ClickActionInput,
  findCardOwner,
  getCardSourceUrl,
  recordCardAction,
  recordClickAction,
} from "./actions/card-actions.js";
export {
  type CostCapState,
  readCostCap,
  type SpendByPurpose,
  type SpendSummary,
  startOfUtcDay,
  summariseSpend,
} from "./costs/cap.js";
export {
  type CostPurpose,
  type CostRecordInput,
  isCostPurpose,
  recordCost,
} from "./costs/record.js";
export * from "./geo/countries.js";
export * from "./geo/detect.js";
export {
  type Chunk,
  type ChunkInput,
  chunkRawItem,
  chunkText,
} from "./items/chunk.js";
export {
  clearPendingCookie,
  consumePendingOnboarding,
  createPendingOnboarding,
  deleteExpiredPendingOnboardings,
  deleteOldConsumedPendingOnboardings,
  generatePendingToken,
  getPendingOnboarding,
  hashEmail,
  hashIp,
  readPendingToken,
  serializePendingCookie,
  startAnonDiscovery,
  updatePendingChannel,
  updatePendingDiscoveryResult,
} from "./onboarding/pending.js";
export {
  assertCanRunDiscovery,
  assertProfileWithinPlan,
  type DiscoveryAllowance,
  findTenantPlan,
  readDiscoveryAllowance,
  readTargetAllowance,
  setTenantPlan,
  type TargetAllowance,
  type TenantPlan,
} from "./plans/limits.js";
export {
  type CreateFromDiscoveryOptions,
  createProfileFromDiscovery,
} from "./profiles/from-discovery.js";
export {
  listTargetsWithoutSources,
  type ProfileProgress,
  readProfileProgress,
  type TargetWithoutSources,
} from "./profiles/progress.js";
export {
  findProfileDelivery,
  findWatchProfile,
  listStopwords,
  listTargets,
  listTopics,
  listWatchProfiles,
} from "./profiles/read.js";
export {
  createWatchProfile,
  deleteWatchProfile,
  type SaveProfileOptions,
  saveWatchProfile,
  type UpdateProfileOptions,
} from "./profiles/write.js";
export {
  type BetaReportRow,
  generateBetaReport,
} from "./reports/beta-report.js";
export {
  type DailyOwnerReport,
  generateDailyOwnerReport,
} from "./reports/daily-owner-report.js";
export { isReturner } from "./reports/returner-rule.js";
export * from "./schemas.js";
export * from "./sources/index.js";
export {
  type CreatedInvitation,
  type CreateInvitationOptions,
  createInvitation,
  findUsableInvitation,
  hashInvitationToken,
  INVITATION_LIFETIME_MS,
  isUsable,
  listInvitations,
  markInvitationAccepted,
  revokeInvitation,
  type UsableInvitation,
} from "./tenancy/invitations.js";
export {
  type AttachUserOptions,
  attachUserToInstance,
  findMembershipByUserId,
  type Membership,
  requireMembership,
} from "./tenancy/membership.js";
export { hasAnyAccount } from "./tenancy/registration.js";
export { findTenant, type Tenant, updateTenantSettings } from "./tenancy/tenant.js";
