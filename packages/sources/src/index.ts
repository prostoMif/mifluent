export {
  type AtsPollOptions,
  type AtsPollResult,
  type AtsProvider,
  atsLocatorSchema,
  type KnownJob,
  type PolledItem as AtsPolledItem,
  pollAtsBoard,
  readBoard,
} from "./connectors/ats.js";
export {
  diffText,
  normalizeText,
  type PageDiffOptions,
  type PageDiffResult,
  pollPageDiff,
} from "./connectors/page-diff.js";
export {
  type PolledItem,
  pollRssSource,
  type RssPollOptions,
  type RssPollResult,
  rssLocatorSchema,
} from "./connectors/rss.js";
export { type DecodeOptions, decodeFeed } from "./feeds/decode.js";
export { htmlToText } from "./feeds/html-text.js";
export { canonicaliseUrl, type FingerprintInput, fingerprintItem } from "./feeds/identity.js";
export {
  type FeedItem,
  type ParsedFeed,
  type ParseFeedOptions,
  parseFeed,
} from "./feeds/parse-feed.js";
export { describeAddress, isPublicAddress } from "./http/address-rules.js";
export { type ResolvedHost, resolvePublicHost } from "./http/resolve-host.js";
export { type SafeFetchOptions, type SafeFetchResult, safeFetch } from "./http/safe-fetch.js";
export {
  hasFailedTooOften,
  isDueForPoll,
  nextIntervalMinutes,
  nextPollDueAt,
  type PollDecision,
  type SourceStatus,
} from "./schedule.js";
