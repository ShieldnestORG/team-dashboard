// ─── Plugin config ────────────────────────────────────────────────────────────

export type MoltbookConfig = {
  apiKeyRef: string;
  agentName: string;
  agentDescription: string;
  autoApproveContent: boolean;
  rateLimitMultiplier: number;
  maxPostsPerDay: number;
  maxCommentsPerDay: number;
  maxVotesPerDay: number;
  blockedPatterns: string[];
};

// ─── API response envelope ──────────────────────────────────────────────────

export type MoltbookResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  hint?: string;
};

// ─── Registration ───────────────────────────────────────────────────────────

export type RegisterRequest = {
  name: string;
  description: string;
};

export type RegisterResponse = {
  agent: {
    api_key: string;
    claim_url: string;
    verification_code: string;
  };
  important: string;
};

export type AgentStatus = {
  claimed: boolean;
  verified: boolean;
  name: string;
  created_at: string;
};

// ─── Posts ───────────────────────────────────────────────────────────────────

export type PostType = "text" | "link" | "image";

export type CreatePostRequest = {
  submolt_name: string;
  title: string;
  content?: string;
  url?: string;
  type?: PostType;
};

export type MoltbookPost = {
  id: string;
  submolt_name: string;
  title: string;
  content?: string;
  url?: string;
  type: PostType;
  author_name: string;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: string;
  pinned?: boolean;
};

export type FeedSort = "hot" | "new" | "top" | "rising";

// ─── Comments ───────────────────────────────────────────────────────────────

export type CreateCommentRequest = {
  content: string;
  parent_id?: string;
};

export type MoltbookComment = {
  id: string;
  post_id: string;
  content: string;
  author_name: string;
  parent_id?: string;
  upvotes: number;
  downvotes: number;
  created_at: string;
  replies?: MoltbookComment[];
};

export type CommentSort = "best" | "new" | "old";

// ─── Communities (Submolts) ─────────────────────────────────────────────────

export type CreateSubmoltRequest = {
  name: string;
  display_name: string;
  description: string;
  allow_crypto?: boolean;
};

export type MoltbookSubmolt = {
  name: string;
  display_name: string;
  description: string;
  allow_crypto: boolean;
  subscriber_count: number;
  created_at: string;
};

// ─── Agent profiles ─────────────────────────────────────────────────────────

export type MoltbookAgent = {
  name: string;
  description?: string;
  claimed: boolean;
  verified: boolean;
  post_count: number;
  comment_count: number;
  karma: number;
  created_at: string;
};

// ─── Search ─────────────────────────────────────────────────────────────────

export type SearchType = "posts" | "comments" | "all";

export type SearchResult = {
  type: "post" | "comment";
  id: string;
  content: string;
  author_name: string;
  score: number;
  created_at: string;
};

// ─── Notifications ──────────────────────────────────────────────────────────

export type MoltbookNotification = {
  id: string;
  type: string;
  message: string;
  post_id?: string;
  read: boolean;
  created_at: string;
};

// ─── Verification ───────────────────────────────────────────────────────────

export type VerificationChallenge = {
  verification_code: string;
  challenge: string;
  expires_in: number;
};

export type VerifyRequest = {
  verification_code: string;
  answer: string;
};

// ─── Entity data shapes (plugin entity store) ───────────────────────────────

export type ContentQueueStatus = "pending" | "approved" | "posted" | "failed" | "rejected";
export type ContentQueueAction = "post" | "comment" | "vote";

export type ContentQueueData = {
  action: ContentQueueAction;
  // Post fields
  submoltName?: string;
  title?: string;
  content?: string;
  url?: string;
  postType?: PostType;
  // Comment fields
  postId?: string;
  parentCommentId?: string;
  // Vote fields
  targetId?: string;
  voteDirection?: "up" | "down";
  targetType?: "post" | "comment";
  // Metadata
  queuedBy: string;
  queuedAt: string;
  approvedAt?: string;
  postedAt?: string;
  error?: string;
  retryCount: number;
  // Audit
  moltbookResponseId?: string;
};

export type AuditLogData = {
  endpoint: string;
  method: string;
  requestBody?: Record<string, unknown>;
  responseStatus: number;
  responseBody?: Record<string, unknown>;
  performedAt: string;
  durationMs: number;
  rateLimitRemaining?: number;
};

// ─── Daily analytics state ──────────────────────────────────────────────────

export type DailyAnalytics = {
  date: string;
  postsSent: number;
  commentsSent: number;
  votesGiven: number;
  postsQueued: number;
  postsFailed: number;
  apiCallsMade: number;
  rateLimitHits: number;
  contentBlocked: number;
};
