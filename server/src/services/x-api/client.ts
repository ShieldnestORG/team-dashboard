// ---------------------------------------------------------------------------
// X API v2 — typed client with auto-auth, rate limiting, and logging
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { getValidToken } from "./oauth.js";
import {
  canMakeRequest,
  canUseDailyBudget,
  enablePanicMode,
  incrementDailyUsage,
  recordRequest,
} from "./rate-limiter.js";
import type {
  SearchResponse,
  TweetCreateParams,
  TweetMetrics,
  TweetResponse,
  UserResponse,
} from "./types.js";

const BASE_URL = "https://api.x.com";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractRateLimitHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["x-rate-limit-limit", "x-rate-limit-remaining", "x-rate-limit-reset"]) {
    const val = headers.get(key);
    if (val) out[key] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class XApiClient {
  private db: Db;
  private companyId: string;
  private accountSlug: string;
  private cachedUserId: string | null = null;

  constructor(db: Db, companyId: string, accountSlug = "primary") {
    this.db = db;
    this.companyId = companyId;
    this.accountSlug = accountSlug;
  }

  // -----------------------------------------------------------------------
  // Internal: authenticated fetch with rate-limit handling
  // -----------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    opts?: {
      body?: Record<string, unknown>;
      budgetAction?: "post" | "like" | "follow" | "reply";
      retryOnAuth?: boolean;
    },
  ): Promise<T> {
    const endpoint = `${method} ${path.split("?")[0]}`;

    // Check per-endpoint rate limit
    const rl = canMakeRequest(endpoint);
    if (!rl.allowed) {
      throw new Error(
        `X API rate limited on ${endpoint}. Retry after ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)}s`,
      );
    }

    // Check daily budget if applicable
    if (opts?.budgetAction) {
      const budget = canUseDailyBudget(opts.budgetAction);
      if (!budget.allowed) {
        throw new Error(
          `X API daily budget exhausted for ${opts.budgetAction} (0 remaining). Try again tomorrow.`,
        );
      }
    }

    const token = await getValidToken(this.db, this.companyId, this.accountSlug);
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const start = Date.now();
    const res = await fetch(url, {
      method,
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
    const elapsed = Date.now() - start;

    // Record rate limit headers
    recordRequest(endpoint, extractRateLimitHeaders(res.headers));

    logger.info(
      { method, path, status: res.status, elapsed },
      `X API ${method} ${path} — ${res.status} (${elapsed}ms)`,
    );

    // Handle 429 — enable panic mode
    if (res.status === 429) {
      enablePanicMode();
      throw new Error(`X API rate limited (429) on ${endpoint}`);
    }

    // Handle 401 — attempt one token refresh
    if (res.status === 401 && opts?.retryOnAuth !== false) {
      logger.warn("X API 401 — attempting token refresh and retry");
      // Force a refresh by calling getValidToken again (it checks expiry)
      // Since we got a 401, the token might have been revoked externally
      return this.request<T>(method, path, { ...opts, retryOnAuth: false });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`X API error ${res.status} on ${endpoint}: ${text}`);
    }

    // Increment daily budget after success
    if (opts?.budgetAction) {
      incrementDailyUsage(opts.budgetAction);
    }

    // Some DELETE endpoints return 204 with no body
    if (res.status === 204) {
      return {} as T;
    }

    return (await res.json()) as T;
  }

  // -----------------------------------------------------------------------
  // User ID helper — cached per client instance
  // -----------------------------------------------------------------------

  private async getUserId(): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId;
    const me = await this.getMe();
    this.cachedUserId = me.data.id;
    return this.cachedUserId;
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /** Get the authenticated user's profile. */
  async getMe(): Promise<UserResponse> {
    return this.request<UserResponse>("GET", "/2/users/me");
  }

  /** Create a new tweet (post). */
  async createTweet(params: TweetCreateParams): Promise<TweetResponse> {
    const body: Record<string, unknown> = { text: params.text };

    if (params.replyTo) {
      body.reply = { in_reply_to_tweet_id: params.replyTo };
    }
    if (params.quoteOf) {
      body.quote_tweet_id = params.quoteOf;
    }
    if (params.mediaIds && params.mediaIds.length > 0) {
      body.media = { media_ids: params.mediaIds };
    }

    const budgetAction = params.replyTo ? "reply" as const : "post" as const;
    return this.request<TweetResponse>("POST", "/2/tweets", { body, budgetAction });
  }

  /** Retweet a tweet by ID. */
  async retweet(tweetId: string): Promise<void> {
    const userId = await this.getUserId();
    await this.request<{ data: { retweeted: boolean } }>(
      "POST",
      `/2/users/${userId}/retweets`,
      { body: { tweet_id: tweetId }, budgetAction: "post" },
    );
  }

  /** Undo a retweet. */
  async unretweet(tweetId: string): Promise<void> {
    const userId = await this.getUserId();
    await this.request<{ data: { retweeted: boolean } }>(
      "DELETE",
      `/2/users/${userId}/retweets/${tweetId}`,
    );
  }

  /** Delete a tweet by ID. */
  async deleteTweet(tweetId: string): Promise<void> {
    await this.request<{ data: { deleted: boolean } }>("DELETE", `/2/tweets/${tweetId}`);
  }

  /** Like a tweet. */
  async likeTweet(tweetId: string): Promise<void> {
    const userId = await this.getUserId();
    await this.request<{ data: { liked: boolean } }>(
      "POST",
      `/2/users/${userId}/likes`,
      { body: { tweet_id: tweetId }, budgetAction: "like" },
    );
  }

  /** Unlike a tweet. */
  async unlikeTweet(tweetId: string): Promise<void> {
    const userId = await this.getUserId();
    await this.request<{ data: { liked: boolean } }>(
      "DELETE",
      `/2/users/${userId}/likes/${tweetId}`,
    );
  }

  /** Follow a user by their user ID. */
  async followUser(targetUserId: string): Promise<void> {
    const userId = await this.getUserId();
    await this.request<{ data: { following: boolean } }>(
      "POST",
      `/2/users/${userId}/following`,
      { body: { target_user_id: targetUserId }, budgetAction: "follow" },
    );
  }

  /** Unfollow a user by their user ID. */
  async unfollowUser(targetUserId: string): Promise<void> {
    const userId = await this.getUserId();
    await this.request<{ data: { following: boolean } }>(
      "DELETE",
      `/2/users/${userId}/following/${targetUserId}`,
    );
  }

  /** Get a tweet with public metrics. */
  async getTweet(tweetId: string): Promise<TweetMetrics> {
    return this.request<TweetMetrics>(
      "GET",
      `/2/tweets/${tweetId}?tweet.fields=public_metrics`,
    );
  }

  /** Search recent tweets (last 7 days). */
  async searchRecent(
    query: string,
    opts?: { maxResults?: number; sinceId?: string },
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({
      query,
      max_results: String(opts?.maxResults ?? 25),
      "tweet.fields": "created_at,public_metrics",
      expansions: "author_id",
      "user.fields": "username,name",
    });
    if (opts?.sinceId) params.set("since_id", opts.sinceId);

    return this.request<SearchResponse>(
      "GET",
      `/2/tweets/search/recent?${params.toString()}`,
    );
  }

  /** Get a user's recent tweets. */
  async getUserTweets(
    userId: string,
    maxResults = 10,
  ): Promise<{ data?: Array<{ id: string; text: string; created_at?: string }> }> {
    return this.request<{ data?: Array<{ id: string; text: string; created_at?: string }> }>(
      "GET",
      `/2/users/${userId}/tweets?max_results=${maxResults}&tweet.fields=created_at`,
    );
  }
}
