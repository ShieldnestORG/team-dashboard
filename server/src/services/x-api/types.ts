// ---------------------------------------------------------------------------
// X API v2 — shared types
// ---------------------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  xUserId: string;
  xUsername: string;
}

export interface TweetCreateParams {
  text: string;
  replyTo?: string;        // tweet ID to reply to
  quoteOf?: string;        // tweet ID to quote
  mediaIds?: string[];     // uploaded media IDs
}

export interface TweetResponse {
  data: { id: string; text: string };
}

export interface UserResponse {
  data: { id: string; name: string; username: string };
}

export interface TweetMetrics {
  data: {
    id: string;
    public_metrics: {
      retweet_count: number;
      reply_count: number;
      like_count: number;
      quote_count: number;
      impression_count: number;
    };
  };
}

export interface SearchResponse {
  data?: Array<{
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics?: Record<string, number>;
  }>;
  meta?: { result_count: number; next_token?: string };
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface RateLimitStatus {
  endpoints: Record<string, RateLimitInfo>;
  dailyBudget: {
    posts: { used: number; limit: number };
    likes: { used: number; limit: number };
    follows: { used: number; limit: number };
    replies: { used: number; limit: number };
  };
  multiplier: number;
  panicMode: boolean;
}
