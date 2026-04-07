import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PulseTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    impression_count: number;
  };
}

export interface PulseUser {
  id: string;
  username: string;
  name: string;
}

interface SearchRecentResponse {
  data?: PulseTweet[];
  includes?: { users?: PulseUser[] };
  meta?: {
    result_count: number;
    newest_id?: string;
    oldest_id?: string;
    next_token?: string;
  };
}

interface RateLimit {
  remaining: number;
  resetAt: Date;
}

// ---------------------------------------------------------------------------
// Search query definitions — each maps to a topic
// ---------------------------------------------------------------------------

export const PULSE_QUERIES: Array<{ query: string; topic: string }> = [
  {
    query: '"TX blockchain" OR "TX chain" OR "tx.org" OR "tokns.fi" OR @txEcosystem OR @txDevHub',
    topic: "tx",
  },
  {
    query: '"Cosmos SDK" OR "$ATOM" OR "IBC transfer" OR "interchain" OR #CosmosSDK',
    topic: "cosmos",
  },
  {
    query: '"XRPL bridge" OR "XRP on Cosmos" OR "XRP IBC" OR "XRPL to TX" OR "XRP staking Cosmos"',
    topic: "xrpl-bridge",
  },
  {
    query: '"tokns.fi" OR "tokns validator" OR "tokns staking" OR "tokns NFT"',
    topic: "tokns",
  },
];

// ---------------------------------------------------------------------------
// Social Pulse Bearer Client — app-only auth for X API v2 search
// ---------------------------------------------------------------------------

export class SocialPulseClient {
  private bearerToken: string;
  private rateLimit: RateLimit | null = null;

  constructor(bearerToken: string) {
    this.bearerToken = bearerToken;
  }

  async searchRecent(
    query: string,
    opts?: { sinceId?: string; maxResults?: number },
  ): Promise<SearchRecentResponse> {
    // Respect rate limits
    if (this.rateLimit && this.rateLimit.remaining <= 1) {
      const waitMs = this.rateLimit.resetAt.getTime() - Date.now();
      if (waitMs > 0) {
        logger.warn(
          { resetIn: Math.ceil(waitMs / 1000) },
          "Pulse search rate limited, skipping",
        );
        return { data: [], meta: { result_count: 0 } };
      }
    }

    const params = new URLSearchParams({
      query,
      "tweet.fields": "public_metrics,created_at,author_id",
      expansions: "author_id",
      "user.fields": "username,name",
      max_results: String(opts?.maxResults ?? 25),
    });

    if (opts?.sinceId) {
      params.set("since_id", opts.sinceId);
    }

    const url = `https://api.x.com/2/tweets/search/recent?${params}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    });

    // Track rate limits from headers
    const limitHeader = res.headers.get("x-rate-limit-remaining");
    const resetHeader = res.headers.get("x-rate-limit-reset");
    if (limitHeader && resetHeader) {
      this.rateLimit = {
        remaining: parseInt(limitHeader, 10),
        resetAt: new Date(parseInt(resetHeader, 10) * 1000),
      };
    }

    if (res.status === 429) {
      logger.warn("Pulse search hit 429 rate limit");
      return { data: [], meta: { result_count: 0 } };
    }

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, "Pulse search failed");
      throw new Error(`X API search failed: ${res.status}`);
    }

    return (await res.json()) as SearchRecentResponse;
  }

  getRateLimitStatus(): RateLimit | null {
    return this.rateLimit;
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _client: SocialPulseClient | null = null;

export function getSocialPulseClient(): SocialPulseClient | null {
  if (_client) return _client;

  const token = process.env.BEARER_TOKEN;
  if (!token) {
    logger.warn("BEARER_TOKEN not set — Social Pulse disabled");
    return null;
  }

  _client = new SocialPulseClient(token);
  return _client;
}
