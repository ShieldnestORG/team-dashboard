// ---------------------------------------------------------------------------
// X API v2 — barrel export
// ---------------------------------------------------------------------------

export type {
  TokenSet,
  TweetCreateParams,
  TweetResponse,
  UserResponse,
  TweetMetrics,
  SearchResponse,
  RateLimitInfo,
  RateLimitStatus,
} from "./types.js";

export {
  generateAuthUrl,
  generateCodeVerifier,
  generateCodeChallenge,
  exchangeCode,
  refreshAccessToken,
  getValidToken,
  saveTokens,
  loadTokens,
  deleteTokens,
  revokeTokens,
  encrypt,
  decrypt,
} from "./oauth.js";

export {
  recordRequest,
  canMakeRequest,
  canUseDailyBudget,
  incrementDailyUsage,
  enablePanicMode,
  setMultiplier,
  getStatus as getRateLimitStatus,
  getDailyBudget,
} from "./rate-limiter.js";

export { XApiClient } from "./client.js";

export { uploadMedia } from "./media.js";

export {
  generateTweetWithContext,
  generateEngagementReply,
  autoGenerateAndQueue,
} from "./content-bridge.js";

export {
  runEngagementCycle,
  scoreEngagementCandidate,
  logEngagement,
} from "./engagement-engine.js";
export type { EngagementTarget, EngagementCycleResult } from "./engagement-engine.js";

export {
  getEngagementInsights,
  discoverNewTargets,
} from "./engagement-learning.js";
export type { EngagementInsights, DiscoveredTarget } from "./engagement-learning.js";

export {
  jitteredDelay,
  shouldBreathingPause,
  breathingPause,
  isWithinActiveHours,
  pickRandom,
} from "./timing.js";
