// ─── Plugin config ────────────────────────────────────────────────────────────

export type TwitterConfig = {
  defaultVenture: string;
  maxQueueSize: number;
  enableAutoEngage: boolean;
  maxPostsPerDay: number;
  minPostGapMinutes: number;
  maxPostGapMinutes: number;
  postingWindowStart: number;
  postingWindowEnd: number;
  // Anti-bot behavior settings
  cycleIntervalMin: number;
  cycleIntervalMax: number;
  dailyLikesLimit: number;
  dailyFollowsLimit: number;
  dailyRepliesLimit: number;
  dailyRepostsLimit: number;
  breathingPauseMinActions: number;
  breathingPauseMaxActions: number;
  breathingPauseMinSeconds: number;
  breathingPauseMaxSeconds: number;
  // X API v2 settings
  xApiEnabled: boolean;
  rateLimitMultiplier: number;
};

// ─── Entity data shapes ──────────────────────────────────────────────────────

export type QueueItemStatus = "pending" | "claimed" | "posted" | "failed" | "cancelled";

export type QueueItemAction = "POST" | "REPLY" | "REPOST";

export type TweetQueueData = {
  action: QueueItemAction;
  text?: string;
  mediaUrls?: string[];
  hashtags?: string[];
  replyToUrl?: string;
  repostUrl?: string;
  scheduledAt?: string;
  venture: string;
  queuedBy: string;
  queuedAt: string;
  claimedAt?: string;
  completedAt?: string;
  tweetUrl?: string;
  tweetId?: string;
  error?: string;
  retryCount: number;
};

export type MissionStatus = "pending" | "active" | "paused" | "completed" | "failed";

export type MissionAction =
  | "SEARCH"
  | "GOTO"
  | "SCROLL"
  | "WAIT"
  | "CLICK_TWEET"
  | "LIKE"
  | "REPOST"
  | "FOLLOW"
  | "REPLY"
  | "POST"
  | "VISIT_PROFILE"
  | "EXTRACT"
  | "BULK_EXTRACT"
  | "NAVIGATE_BACK";

export type MissionStep = {
  action: MissionAction;
  params?: Record<string, unknown>;
  expected_view?: string;
};

export type MissionData = {
  name?: string;
  steps: MissionStep[];
  currentStep: number;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  results: unknown[];
};

export type TargetStatus = "active" | "paused" | "removed";

export type TargetData = {
  handle: string;
  displayName?: string;
  profileUrl: string;
  engageActions: string[];
  addedBy: string;
  addedAt: string;
  lastEngagedAt?: string;
  engagementCount: number;
  venture: string;
};

export type ExtractedTweetData = {
  tweetUrl: string;
  authorHandle: string;
  text: string;
  timestamp?: string;
  likes?: number;
  reposts?: number;
  replies?: number;
  extractedAt: string;
  missionId?: string;
};

export type ExtractedProfileData = {
  handle: string;
  displayName: string;
  bio?: string;
  followers?: number;
  following?: number;
  verified?: boolean;
  extractedAt: string;
};

export type ActionLogData = {
  action: string;
  targetUrl?: string;
  queueItemId?: string;
  missionId?: string;
  performedAt: string;
  durationMs?: number;
  error?: string;
};

// ─── Daily analytics state ───────────────────────────────────────────────────

export type DailyAnalytics = {
  date: string;
  postsSent: number;
  postsQueued: number;
  postsFailed: number;
  likes: number;
  reposts: number;
  follows: number;
  replies: number;
  extractions: number;
  profileExtractions: number;
};

// ─── X API v2 execution types ────────────────────────────────────────────────

export interface PostExecutionResult {
  tweetId: string;
  tweetUrl: string;
  postedAt: string;
  rateLimitRemaining?: number;
}

export interface EngagementAction {
  type: "like" | "reply" | "retweet" | "follow" | "quote";
  targetTweetId?: string;
  targetUserId?: string;
  targetUsername?: string;
  replyText?: string;
}

export interface EngagementResult {
  action: string;
  targetTweetId?: string;
  targetUserId?: string;
  success: boolean;
  error?: string;
  executedAt: string;
  delayMs: number;
}
