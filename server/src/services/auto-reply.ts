// ---------------------------------------------------------------------------
// Auto-Reply Service — watches for tweets from target accounts and replies
// ---------------------------------------------------------------------------

import { eq, and, sql, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { autoReplyConfig, autoReplyLog } from "@paperclipai/db";
import { XApiClient } from "./x-api/client.js";
import { loadTokens } from "./x-api/oauth.js";
import { canUseDailyBudget } from "./x-api/rate-limiter.js";
import { publishGlobalLiveEvent } from "./live-events.js";
import { logger } from "../middleware/logger.js";
import type { TweetData, AuthorData } from "./social-pulse.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutoReplyConfigRow {
  id: string;
  companyId: string;
  targetType: string; // 'account' | 'keyword'
  targetXUserId: string | null;
  targetXUsername: string; // @handle for accounts, keyword/hashtag for keywords
  enabled: boolean;
  replyMode: string;
  replyTemplates: string[] | null;
  aiPrompt: string | null;
  maxRepliesPerDay: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
}

// ---------------------------------------------------------------------------
// Ollama client for AI-generated replies
// ---------------------------------------------------------------------------

const OLLAMA_URL = process.env.OLLAMA_URL || "http://168.231.127.180:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

async function callOllamaForReply(systemPrompt: string, tweetText: string): Promise<string> {
  const prompt = `${systemPrompt}\n\nTweet to reply to:\n"${tweetText}"\n\nWrite your reply (under 280 characters, no quotes):`;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Ollama error (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { response: string };
  let reply = data.response.trim();

  // Strip markdown and quotes
  reply = reply.replace(/^["']|["']$/g, "").replace(/\*\*/g, "").replace(/^#+\s/gm, "");

  // Truncate to 280 chars
  if (reply.length > 280) {
    reply = reply.substring(0, 277) + "...";
  }

  return reply;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

class AutoReplyService {
  private db: Db;
  private configsByAuthorId = new Map<string, AutoReplyConfigRow>();
  private configsByUsername = new Map<string, AutoReplyConfigRow>();
  private keywordConfigs: AutoReplyConfigRow[] = [];
  private replyQueue: Array<{ tweet: TweetData; author: AuthorData; config: AutoReplyConfigRow; source: string }> = [];
  private processing = false;

  constructor(db: Db) {
    this.db = db;
  }

  async loadConfigs(): Promise<void> {
    const rows = await this.db
      .select()
      .from(autoReplyConfig)
      .where(and(
        eq(autoReplyConfig.companyId, COMPANY_ID),
        eq(autoReplyConfig.enabled, true),
      ));

    this.configsByAuthorId.clear();
    this.configsByUsername.clear();
    this.keywordConfigs = [];

    for (const row of rows) {
      const config: AutoReplyConfigRow = {
        id: row.id,
        companyId: row.companyId,
        targetType: row.targetType ?? "account",
        targetXUserId: row.targetXUserId,
        targetXUsername: row.targetXUsername,
        enabled: row.enabled,
        replyMode: row.replyMode,
        replyTemplates: row.replyTemplates as string[] | null,
        aiPrompt: row.aiPrompt,
        maxRepliesPerDay: row.maxRepliesPerDay,
        minDelaySeconds: row.minDelaySeconds,
        maxDelaySeconds: row.maxDelaySeconds,
      };

      if (config.targetType === "keyword") {
        this.keywordConfigs.push(config);
      } else {
        // Account target
        if (row.targetXUserId) {
          this.configsByAuthorId.set(row.targetXUserId, config);
        }
        this.configsByUsername.set(row.targetXUsername.toLowerCase(), config);
      }
    }

    logger.info(
      {
        configCount: rows.length,
        accounts: rows.filter((r) => (r.targetType ?? "account") === "account").map((r) => r.targetXUsername),
        keywords: rows.filter((r) => r.targetType === "keyword").map((r) => r.targetXUsername),
      },
      "Auto-reply configs loaded",
    );
  }

  async checkAndReply(
    tweet: TweetData,
    author: AuthorData,
    source: string,
  ): Promise<void> {
    // Fast path: check if this tweet's author matches any account target
    let config = this.configsByAuthorId.get(tweet.authorId);
    if (!config) {
      config = this.configsByUsername.get(author.username.toLowerCase());
    }

    // Check keyword targets if no account match
    if (!config) {
      const textLower = tweet.text.toLowerCase();
      for (const kw of this.keywordConfigs) {
        const keyword = kw.targetXUsername.toLowerCase();
        if (textLower.includes(keyword)) {
          config = kw;
          break;
        }
      }
    }

    if (!config) return;

    // Skip if we're replying to ourselves
    const tokens = await loadTokens(this.db, COMPANY_ID).catch(() => null);
    if (tokens && tokens.xUserId === tweet.authorId) return;

    // Check if already replied to this tweet
    const existing = await this.db
      .select({ id: autoReplyLog.id })
      .from(autoReplyLog)
      .where(eq(autoReplyLog.sourceTweetId, tweet.id))
      .limit(1);

    if (existing.length > 0) return;

    // Check per-config daily limit
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const dailyCount = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(autoReplyLog)
      .where(and(
        eq(autoReplyLog.configId, config.id),
        gte(autoReplyLog.createdAt, todayStart),
        eq(autoReplyLog.status, "sent"),
      ));

    if ((dailyCount[0]?.count ?? 0) >= config.maxRepliesPerDay) {
      logger.info(
        { target: config.targetXUsername, limit: config.maxRepliesPerDay },
        "Auto-reply daily limit reached for target",
      );
      return;
    }

    // Check global rate limit
    const budget = canUseDailyBudget("reply");
    if (!budget.allowed) {
      logger.info("Auto-reply skipped: global reply budget exhausted");
      // Log it as rate_limited
      await this.logReply(config, tweet, author, "", "rate_limited", "Global rate limit exhausted", 0, source);
      return;
    }

    // Queue the reply
    this.replyQueue.push({ tweet, author, config, source });
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.replyQueue.length > 0) {
        const item = this.replyQueue.shift()!;
        const startTime = Date.now();

        try {
          // Randomized delay to avoid bot detection
          const { config, tweet, author, source } = item;
          const delay = config.minDelaySeconds * 1000 +
            Math.random() * (config.maxDelaySeconds - config.minDelaySeconds) * 1000;

          await new Promise((resolve) => setTimeout(resolve, delay));

          // Generate reply text
          let replyText: string;
          if (config.replyMode === "ai" && config.aiPrompt) {
            replyText = await callOllamaForReply(config.aiPrompt, tweet.text);
          } else if (config.replyTemplates && config.replyTemplates.length > 0) {
            const template = config.replyTemplates[Math.floor(Math.random() * config.replyTemplates.length)];
            replyText = template
              .replace(/\{author\}/g, `@${author.username}`)
              .replace(/\{topic\}/g, "TX")
              .replace(/\{date\}/g, new Date().toLocaleDateString());
          } else {
            logger.warn({ configId: config.id }, "Auto-reply config has no templates or AI prompt");
            return;
          }

          if (!replyText || replyText.length === 0) {
            await this.logReply(config, tweet, author, "", "failed", "Empty reply generated", 0, source);
            continue;
          }

          // Send the reply
          const client = new XApiClient(this.db, COMPANY_ID);
          const result = await client.createTweet({
            text: replyText,
            replyTo: tweet.id,
          });

          const latencyMs = Date.now() - startTime;

          await this.logReply(
            config, tweet, author,
            replyText, "sent", null,
            latencyMs, source,
            result.data?.id,
          );

          logger.info(
            {
              target: config.targetXUsername,
              tweetId: tweet.id,
              replyId: result.data?.id,
              latencyMs,
              source,
            },
            "Auto-reply sent",
          );

          publishGlobalLiveEvent({
            type: "auto_reply.sent",
            payload: {
              target: config.targetXUsername,
              tweetId: tweet.id,
              replyId: result.data?.id,
              latencyMs,
            },
          });
        } catch (err) {
          const latencyMs = Date.now() - startTime;
          const errorMsg = String(err);

          await this.logReply(
            item.config, item.tweet, item.author,
            "", "failed", errorMsg,
            latencyMs, item.source,
          );

          logger.error(
            { err, target: item.config.targetXUsername, tweetId: item.tweet.id },
            "Auto-reply failed",
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async logReply(
    config: AutoReplyConfigRow,
    tweet: TweetData,
    author: AuthorData,
    replyText: string,
    status: string,
    error: string | null,
    latencyMs: number,
    source: string,
    replyTweetId?: string,
  ): Promise<void> {
    try {
      await this.db.insert(autoReplyLog).values({
        companyId: COMPANY_ID,
        configId: config.id,
        sourceTweetId: tweet.id,
        sourceAuthorUsername: author.username,
        replyTweetId: replyTweetId ?? null,
        replyText: replyText || "(no reply generated)",
        status,
        error,
        latencyMs,
        source,
      });
    } catch (err) {
      logger.error({ err }, "Failed to log auto-reply");
    }
  }

  // ── Account polling — direct timeline check ────────────────────────

  async pollTargetAccounts(): Promise<{ checked: number; newReplies: number }> {
    // Only poll account-type targets that have valid user IDs (not keyword targets)
    const configs = [...this.configsByAuthorId.values()].filter(
      (c) => c.enabled && c.targetXUserId && c.targetType !== "keyword" && !c.targetXUserId.startsWith("pending_"),
    );

    if (configs.length === 0) return { checked: 0, newReplies: 0 };

    // Verify OAuth tokens exist
    const tokens = await loadTokens(this.db, COMPANY_ID).catch(() => null);
    if (!tokens) {
      logger.warn("Auto-reply account poll skipped: no X OAuth tokens");
      return { checked: 0, newReplies: 0 };
    }

    const client = new XApiClient(this.db, COMPANY_ID);
    let newReplies = 0;

    for (const config of configs) {
      try {
        const result = await client.getUserTweets(config.targetXUserId!, 5);
        if (!result.data || result.data.length === 0) continue;

        for (const tweet of result.data) {
          // Skip old tweets (more than 1 hour old)
          if (tweet.created_at) {
            const age = Date.now() - new Date(tweet.created_at).getTime();
            if (age > 60 * 60 * 1000) continue;
          }

          await this.checkAndReply(
            {
              id: tweet.id,
              text: tweet.text,
              authorId: config.targetXUserId!,
              createdAt: tweet.created_at ?? new Date().toISOString(),
              publicMetrics: null,
            },
            {
              username: config.targetXUsername,
              name: null,
            },
            "account-poll",
          );
        }
      } catch (err) {
        logger.error(
          { err, target: config.targetXUsername },
          "Auto-reply account poll failed for target",
        );
      }
    }

    return { checked: configs.length, newReplies };
  }

  // ── Stats ───────────────────────────────────────────────────────────

  async getStats(): Promise<{
    todaySent: number;
    todayFailed: number;
    todayRateLimited: number;
    avgLatencyMs: number;
  }> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const rows = await this.db
      .select({
        status: autoReplyLog.status,
        count: sql<number>`count(*)::int`,
        avgLatency: sql<number>`avg(${autoReplyLog.latencyMs})::int`,
      })
      .from(autoReplyLog)
      .where(gte(autoReplyLog.createdAt, todayStart))
      .groupBy(autoReplyLog.status);

    let todaySent = 0;
    let todayFailed = 0;
    let todayRateLimited = 0;
    let avgLatencyMs = 0;

    for (const row of rows) {
      if (row.status === "sent") {
        todaySent = row.count;
        avgLatencyMs = row.avgLatency ?? 0;
      }
      if (row.status === "failed") todayFailed = row.count;
      if (row.status === "rate_limited") todayRateLimited = row.count;
    }

    return { todaySent, todayFailed, todayRateLimited, avgLatencyMs };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _service: AutoReplyService | null = null;

export async function initAutoReplyService(db: Db): Promise<void> {
  _service = new AutoReplyService(db);
  try {
    await _service.loadConfigs();
  } catch (err) {
    // Table might not exist yet — that's OK, configs will be empty
    logger.warn({ err }, "Auto-reply config load failed (table may not exist yet)");
  }
}

export function getAutoReplyService(): AutoReplyService | null {
  return _service;
}
