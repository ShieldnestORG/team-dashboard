// ---------------------------------------------------------------------------
// X API v2 — post and engagement executor
// ---------------------------------------------------------------------------
// The plugin runs in the same Node.js process as the server. We use dynamic
// imports with runtime path resolution to access server modules without
// breaking TypeScript's rootDir constraints.
// ---------------------------------------------------------------------------

import type { TweetQueueData, PostExecutionResult, EngagementAction, EngagementResult } from "./types.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Runtime module resolution — avoids TS rootDir issues by using dynamic
// import() with computed string paths so TS cannot statically analyze them
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
// Navigate from packages/plugins/plugin-twitter/src (or dist) up to project root
const SERVER_SERVICES = resolve(__dirname, "../../../../server/src/services/x-api");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _modules: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _xClient: any = null;

async function loadModules(): Promise<void> {
  if (_modules) return;

  // Build paths at runtime so TypeScript doesn't try to follow them
  const clientPath = resolve(SERVER_SERVICES, "client.js");
  const oauthPath = resolve(SERVER_SERVICES, "oauth.js");
  const rlPath = resolve(SERVER_SERVICES, "rate-limiter.js");

  // Resolve @paperclipai/db path dynamically (not a direct dependency of this plugin)
  const dbPkgPath = resolve(__dirname, "../../../../packages/db/src/index.js");

  const [clientMod, oauthMod, rlMod, dbMod] = await Promise.all([
    import(/* @vite-ignore */ clientPath),
    import(/* @vite-ignore */ oauthPath),
    import(/* @vite-ignore */ rlPath),
    import(/* @vite-ignore */ dbPkgPath),
  ]);

  _modules = {
    XApiClient: clientMod.XApiClient,
    loadTokens: oauthMod.loadTokens,
    getValidToken: oauthMod.getValidToken,
    getRateLimitStatus: rlMod.getStatus,
    canUseDailyBudget: rlMod.canUseDailyBudget,
    setMultiplier: rlMod.setMultiplier,
    createDb: dbMod.createDb,
  };
}

function getDb(): unknown {
  if (!_db) {
    if (!_modules) throw new Error("Modules not loaded — call loadModules() first");
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set — cannot create DB connection for X API");
    _db = _modules.createDb(url);
  }
  return _db;
}

function getCompanyId(): string {
  const id = process.env.TEAM_DASHBOARD_COMPANY_ID;
  if (!id) throw new Error("TEAM_DASHBOARD_COMPANY_ID not set");
  return id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getXApiClient(): Promise<any> {
  await loadModules();
  if (!_xClient) {
    _xClient = new _modules.XApiClient(getDb(), getCompanyId());
  }
  return _xClient;
}

// ---------------------------------------------------------------------------
// Connection status check
// ---------------------------------------------------------------------------

export async function checkXApiConnection(): Promise<{
  connected: boolean;
  username?: string;
  rateLimits?: {
    endpoints: Record<string, unknown>;
    dailyBudget: {
      posts: { used: number; limit: number };
      likes: { used: number; limit: number };
      follows: { used: number; limit: number };
      replies: { used: number; limit: number };
    };
    multiplier: number;
    panicMode: boolean;
  };
}> {
  try {
    await loadModules();
    const tokens = await _modules.loadTokens(getDb(), getCompanyId());
    if (!tokens) return { connected: false };

    return {
      connected: true,
      username: tokens.xUsername,
      rateLimits: _modules.getRateLimitStatus(),
    };
  } catch {
    return { connected: false };
  }
}

// ---------------------------------------------------------------------------
// Tweet ID extraction
// ---------------------------------------------------------------------------

export function extractTweetId(url: string): string {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : "";
}

// ---------------------------------------------------------------------------
// Jittered delay for human-like timing
// ---------------------------------------------------------------------------

export function jitteredDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ---------------------------------------------------------------------------
// Post execution
// ---------------------------------------------------------------------------

export async function executePost(queueItem: TweetQueueData): Promise<PostExecutionResult> {
  const client = await getXApiClient();

  switch (queueItem.action) {
    case "POST": {
      let text = queueItem.text || "";
      if (queueItem.hashtags && queueItem.hashtags.length > 0) {
        const tags = queueItem.hashtags
          .map((h: string) => (h.startsWith("#") ? h : `#${h}`))
          .join(" ");
        text += `\n\n${tags}`;
      }

      const result = await client.createTweet({ text });
      return {
        tweetId: result.data.id,
        tweetUrl: `https://x.com/i/status/${result.data.id}`,
        postedAt: new Date().toISOString(),
      };
    }

    case "REPLY": {
      const replyToId = extractTweetId(queueItem.replyToUrl || "");
      if (!replyToId) {
        throw new Error(`Cannot extract tweet ID from reply URL: ${queueItem.replyToUrl}`);
      }

      const result = await client.createTweet({
        text: queueItem.text || "",
        replyTo: replyToId,
      });
      return {
        tweetId: result.data.id,
        tweetUrl: `https://x.com/i/status/${result.data.id}`,
        postedAt: new Date().toISOString(),
      };
    }

    case "REPOST": {
      const tweetId = extractTweetId(queueItem.repostUrl || "");
      if (!tweetId) {
        throw new Error(`Cannot extract tweet ID from repost URL: ${queueItem.repostUrl}`);
      }

      await retweetViaDirect(tweetId);
      return {
        tweetId,
        tweetUrl: `https://x.com/i/status/${tweetId}`,
        postedAt: new Date().toISOString(),
      };
    }

    default:
      throw new Error(`Unknown queue action: ${queueItem.action}`);
  }
}

// ---------------------------------------------------------------------------
// Thread execution — post tweets sequentially, each replying to the previous
// ---------------------------------------------------------------------------

export async function executeThread(
  tweets: string[],
): Promise<PostExecutionResult> {
  const client = await getXApiClient();
  let previousTweetId: string | undefined;

  for (let i = 0; i < tweets.length; i++) {
    const result = await client.createTweet({
      text: tweets[i],
      replyTo: previousTweetId,
    });
    previousTweetId = result.data.id;

    // Jittered delay between thread tweets (1-3s)
    if (i < tweets.length - 1) {
      await jitteredDelay(1000, 3000);
    }
  }

  return {
    tweetId: previousTweetId!,
    tweetUrl: `https://x.com/i/status/${previousTweetId}`,
    postedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Engagement execution
// ---------------------------------------------------------------------------

export async function executeEngagement(action: EngagementAction): Promise<EngagementResult> {
  const client = await getXApiClient();
  const start = Date.now();

  try {
    switch (action.type) {
      case "like": {
        if (!action.targetTweetId) throw new Error("targetTweetId required for like");
        await client.likeTweet(action.targetTweetId);
        break;
      }

      case "follow": {
        if (!action.targetUserId) throw new Error("targetUserId required for follow");
        await client.followUser(action.targetUserId);
        break;
      }

      case "reply": {
        if (!action.targetTweetId || !action.replyText) {
          throw new Error("targetTweetId and replyText required for reply");
        }
        await client.createTweet({
          text: action.replyText,
          replyTo: action.targetTweetId,
        });
        break;
      }

      case "retweet": {
        if (!action.targetTweetId) throw new Error("targetTweetId required for retweet");
        await retweetViaDirect(action.targetTweetId);
        break;
      }

      case "quote": {
        if (!action.targetTweetId || !action.replyText) {
          throw new Error("targetTweetId and replyText required for quote");
        }
        await client.createTweet({
          text: action.replyText,
          quoteOf: action.targetTweetId,
        });
        break;
      }

      default:
        throw new Error(`Unknown engagement action: ${action.type}`);
    }

    return {
      action: action.type,
      targetTweetId: action.targetTweetId,
      targetUserId: action.targetUserId,
      success: true,
      executedAt: new Date().toISOString(),
      delayMs: Date.now() - start,
    };
  } catch (err) {
    return {
      action: action.type,
      targetTweetId: action.targetTweetId,
      targetUserId: action.targetUserId,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      executedAt: new Date().toISOString(),
      delayMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Retweet via direct fetch (XApiClient doesn't expose retweet endpoint)
// ---------------------------------------------------------------------------

async function retweetViaDirect(tweetId: string): Promise<void> {
  await loadModules();
  const client = await getXApiClient();
  const me = await client.getMe();
  const userId = me.data.id;

  const token = await _modules.getValidToken(getDb(), getCompanyId());

  const res = await fetch(`https://api.x.com/2/users/${userId}/retweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tweet_id: tweetId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Retweet failed (${res.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Daily budget check (delegates to rate limiter)
// ---------------------------------------------------------------------------

export async function checkDailyBudget(action: "post" | "like" | "follow" | "reply"): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  await loadModules();
  return _modules.canUseDailyBudget(action);
}

export async function getRateLimitStatus(): Promise<unknown> {
  await loadModules();
  return _modules.getRateLimitStatus();
}
