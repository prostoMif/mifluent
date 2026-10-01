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
  type EmailCardSummary,
  findEmailCard,
  pauseEmailDelivery,
  recordEmailCardAction,
  resumeEmailDelivery,
} from "./actions/email-links.js";
export * from "./billing/index.js";
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
export { ANON_TENANT_ID, ensureAnonTenant } from "./onboarding/anon-tenant.js";
export {
  type CompletedOnboarding,
  completePendingOnboarding,
  findPendingForEmail,
  profileInputFromPending,
} from "./onboarding/complete.js";
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
  recordPendingDiscoveryFailure,
  savePendingReview,
  serializePendingCookie,
  startAnonDiscovery,
  updatePendingChannel,
  updatePendingDiscoveryResult,
} from "./onboarding/pending.js";
export * from "./packs/index.js";
export {
  assertCanRunDiscovery,
  assertCanWatchPage,
  assertProfileWithinPlan,
  type DiscoveryAllowance,
  findTenantPlan,
  readDiscoveryAllowance,
  readTargetAllowance,
  readWatchedPagesAllowance,
  setTenantPlan,
  type TargetAllowance,
  type TenantPlan,
  type WatchedPagesAllowance,
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
  findWatchTarget,
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
export * from "./public-radar/index.js";
export { type AcquisitionRow, acquisitionSummary } from "./reports/acquisition.js";
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
  type EventKind,
  fetchCheckCount,
  fetchPriceChanges,
  fetchTargetHeader,
  fetchTargetTimeline,
  fetchVacancies,
  getHistoryDaysLimit,
  PAGE_SIZE,
  type PriceChange,
  type TargetHeader,
  type TargetHistoryResult,
  type TimelineEntry,
  type Vacancy,
} from "./targets/history.js";
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
