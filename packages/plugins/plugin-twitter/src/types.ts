// ─── Plugin config ────────────────────────────────────────────────────────────

export type TwitterConfig = {
  extensionSecret: string;
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
  extensionSessionId: string;
};

// ─── Extension session state ─────────────────────────────────────────────────

export type ExtensionSession = {
  sessionId: string;
  lastHeartbeat: string;
  botEnabled: boolean;
  bearerToken?: string;
  csrfToken?: string;
  currentUrl?: string;
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

// ─── Webhook payloads from extension ─────────────────────────────────────────

export type ExtPollResponse = {
  queueItem?: {
    id: string;
    action: QueueItemAction;
    text?: string;
    mediaUrls?: string[];
    hashtags?: string[];
    replyToUrl?: string;
    repostUrl?: string;
  } | null;
  mission?: {
    id: string;
    steps: MissionStep[];
    currentStep: number;
  } | null;
  targets?: Array<{
    handle: string;
    engageActions: string[];
  }>;
};

export type ExtResultPayload = {
  type: "post" | "action" | "extract" | "profile";
  queueItemId?: string;
  missionId?: string;
  success: boolean;
  tweetUrl?: string;
  error?: string;
  action?: string;
  durationMs?: number;
  extractedData?: unknown;
  sessionId: string;
};

export type ExtProgressPayload = {
  missionId: string;
  currentStep: number;
  stepResult?: unknown;
  sessionId: string;
};

export type ExtHeartbeatPayload = {
  sessionId: string;
  botEnabled: boolean;
  bearerToken?: string;
  csrfToken?: string;
  currentUrl?: string;
};
