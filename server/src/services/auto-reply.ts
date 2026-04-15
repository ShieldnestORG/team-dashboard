// ---------------------------------------------------------------------------
// Auto-Reply Service — watches for tweets via search and replies
// ---------------------------------------------------------------------------

import { eq, and, sql, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { autoReplyConfig, autoReplyLog, autoReplySettings } from "@paperclipai/db";
import { XApiClient } from "./x-api/client.js";
import { loadTokens } from "./x-api/oauth.js";
import { canUseDailyBudget, canAffordRead, recordReadCost, updateBudgetConfig } from "./x-api/rate-limiter.js";
import { publishGlobalLiveEvent } from "./live-events.js";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Tweet types
// ---------------------------------------------------------------------------

export interface TweetData {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
  publicMetrics: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    impression_count: number;
  } | null;
}

export interface AuthorData {
  username: string;
  name: string | null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AutoReplyGlobalSettings {
  pollIntervalMinutes: number;
  dailySpendCapUsd: number;
  globalMaxRepliesPerDay: number;
  defaultMinDelaySeconds: number;
  defaultMaxDelaySeconds: number;
  defaultMaxRepliesPerTarget: number;
  enabled: boolean;
}

const DEFAULT_SETTINGS: AutoReplyGlobalSettings = {
  pollIntervalMinutes: 30,
  dailySpendCapUsd: 5.0,
  globalMaxRepliesPerDay: 200,
  defaultMinDelaySeconds: 3,
  defaultMaxDelaySeconds: 15,
  defaultMaxRepliesPerTarget: 10,
  enabled: true,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutoReplyConfigRow {
  id: string;
  companyId: string;
  targetType: string;
  targetXUserId: string | null;
  targetXUsername: string;
  enabled: boolean;
  replyMode: string;
  replyTemplates: string[] | null;
  aiPrompt: string | null;
  maxRepliesPerDay: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  xAccountSlug: string;
}

// ---------------------------------------------------------------------------
// Ollama client for AI-generated replies
// ---------------------------------------------------------------------------

import { callOllamaGenerate } from "./ollama-client.js";

async function callOllamaForReply(systemPrompt: string, tweetText: string): Promise<string> {
  const prompt = `${systemPrompt}\n\nTweet to reply to:\n"${tweetText}"\n\nWrite your reply (under 280 characters, no quotes):`;
  const raw = await callOllamaGenerate(prompt);
  let reply = raw.replace(/^["']|["']$/g, "").replace(/\*\*/g, "").replace(/^#+\s/gm, "");
  if (reply.length > 280) reply = reply.substring(0, 277) + "...";
  return reply;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
const MAX_QUERY_LENGTH = 512;

class AutoReplyService {
  private db: Db;
  private configsByAuthorId = new Map<string, AutoReplyConfigRow>();
  private configsByUsername = new Map<string, AutoReplyConfigRow>();
  private keywordConfigs: AutoReplyConfigRow[] = [];
  private allConfigs: AutoReplyConfigRow[] = [];
  private replyQueue: Array<{ tweet: TweetData; author: AuthorData; config: AutoReplyConfigRow; source: string }> = [];
  private processing = false;
  private lastSeenId: string | null = null;
  settings: AutoReplyGlobalSettings = { ...DEFAULT_SETTINGS };

  constructor(db: Db) {
    this.db = db;
  }

  async loadSettings(): Promise<void> {
    try {
      const [row] = await this.db
        .select()
        .from(autoReplySettings)
        .where(eq(autoReplySettings.companyId, COMPANY_ID))
        .limit(1);

      if (row?.settings) {
        this.settings = { ...DEFAULT_SETTINGS, ...(row.settings as AutoReplyGlobalSettings) };
      }
    } catch {
      // Table might not exist yet
      logger.warn("Auto-reply settings load failed (table may not exist yet)");
    }

    // Sync budget config with rate limiter
    updateBudgetConfig({
      dailySpendCapUsd: this.settings.dailySpendCapUsd,
      maxRepliesPerDay: this.settings.globalMaxRepliesPerDay,
    });
  }

  async saveSettings(updates: Partial<AutoReplyGlobalSettings>): Promise<AutoReplyGlobalSettings> {
    this.settings = { ...this.settings, ...updates };

    // Upsert settings
    const existing = await this.db
      .select({ id: autoReplySettings.id })
      .from(autoReplySettings)
      .where(eq(autoReplySettings.companyId, COMPANY_ID))
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(autoReplySettings)
        .set({ settings: this.settings, updatedAt: new Date() })
        .where(eq(autoReplySettings.companyId, COMPANY_ID));
    } else {
      await this.db
        .insert(autoReplySettings)
        .values({ companyId: COMPANY_ID, settings: this.settings });
    }

    // Sync budget config
    updateBudgetConfig({
      dailySpendCapUsd: this.settings.dailySpendCapUsd,
      maxRepliesPerDay: this.settings.globalMaxRepliesPerDay,
    });

    return this.settings;
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
    this.allConfigs = [];

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
        xAccountSlug: (row.xAccountSlug as string | null) ?? "primary",
      };

      this.allConfigs.push(config);

      if (config.targetType === "keyword") {
        this.keywordConfigs.push(config);
      } else {
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

  // ── Build search query covering all targets ───────────────────────

  private buildSearchQueries(): string[] {
    const parts: string[] = [];

    // Account targets: from:username
    for (const config of this.allConfigs) {
      if (config.targetType !== "keyword" && config.targetXUsername) {
        parts.push(`from:${config.targetXUsername}`);
      }
    }

    // Keyword targets: "keyword"
    for (const config of this.keywordConfigs) {
      parts.push(`"${config.targetXUsername}"`);
    }

    if (parts.length === 0) return [];

    // Chunk into queries under 512 chars
    const queries: string[] = [];
    let current = "";

    for (const part of parts) {
      const addition = current ? ` OR ${part}` : part;
      if ((current + addition).length > MAX_QUERY_LENGTH) {
        if (current) queries.push(current);
        current = part;
      } else {
        current += addition;
      }
    }
    if (current) queries.push(current);

    return queries;
  }

  // ── Search-based polling ──────────────────────────────────────────

  async pollViaSearch(): Promise<{ checked: number; found: number; newReplies: number }> {
    if (!this.settings.enabled) {
      return { checked: 0, found: 0, newReplies: 0 };
    }

    const queries = this.buildSearchQueries();
    if (queries.length === 0) return { checked: 0, found: 0, newReplies: 0 };

    // Check if we can afford reads
    if (!canAffordRead(25)) {
      logger.info("Auto-reply poll skipped: daily spend cap would be exceeded");
      return { checked: 0, found: 0, newReplies: 0 };
    }

    const tokens = await loadTokens(this.db, COMPANY_ID).catch(() => null);
    if (!tokens) {
      logger.warn("Auto-reply poll skipped: no X OAuth tokens");
      return { checked: 0, found: 0, newReplies: 0 };
    }

    const client = new XApiClient(this.db, COMPANY_ID, "primary");
    let totalFound = 0;
    let newReplies = 0;

    for (const query of queries) {
      try {
        const result = await client.searchRecent(query, {
          maxResults: 25,
          sinceId: this.lastSeenId ?? undefined,
        });

        // Record read cost
        const readCount = result.meta?.result_count ?? 0;
        if (readCount > 0) recordReadCost(readCount);

        // Track newest ID for next poll
        if (result.meta?.newest_id) {
          this.lastSeenId = result.meta.newest_id;
        }

        if (!result.data || result.data.length === 0) continue;

        // Build author lookup from includes
        const authorMap = new Map<string, { username: string; name: string }>();
        if (result.includes?.users) {
          for (const user of result.includes.users) {
            authorMap.set(user.id, { username: user.username, name: user.name });
          }
        }

        totalFound += result.data.length;

        for (const tweet of result.data) {
          // Skip tweets older than 1 hour
          if (tweet.created_at) {
            const age = Date.now() - new Date(tweet.created_at).getTime();
            if (age > 60 * 60 * 1000) continue;
          }

          const authorInfo = authorMap.get(tweet.author_id);

          await this.checkAndReply(
            {
              id: tweet.id,
              text: tweet.text,
              authorId: tweet.author_id,
              createdAt: tweet.created_at ?? new Date().toISOString(),
              publicMetrics: tweet.public_metrics ? {
                like_count: tweet.public_metrics.like_count ?? 0,
                retweet_count: tweet.public_metrics.retweet_count ?? 0,
                reply_count: tweet.public_metrics.reply_count ?? 0,
                impression_count: tweet.public_metrics.impression_count ?? 0,
              } : null,
            },
            {
              username: authorInfo?.username ?? "unknown",
              name: authorInfo?.name ?? null,
            },
            "search-poll",
          );
          newReplies++;
        }
      } catch (err) {
        logger.error({ err, query }, "Auto-reply search poll failed");
      }
    }

    return { checked: queries.length, found: totalFound, newReplies };
  }

  // ── Check and reply ───────────────────────────────────────────────

  async checkAndReply(
    tweet: TweetData,
    author: AuthorData,
    source: string,
  ): Promise<void> {
    let config = this.configsByAuthorId.get(tweet.authorId);
    if (!config) {
      config = this.configsByUsername.get(author.username.toLowerCase());
    }

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

    const tokens = await loadTokens(this.db, COMPANY_ID).catch(() => null);
    if (tokens && tokens.xUserId === tweet.authorId) return;

    const existing = await this.db
      .select({ id: autoReplyLog.id })
      .from(autoReplyLog)
      .where(eq(autoReplyLog.sourceTweetId, tweet.id))
      .limit(1);

    if (existing.length > 0) return;

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
      logger.info({ target: config.targetXUsername, limit: config.maxRepliesPerDay }, "Auto-reply daily limit reached for target");
      return;
    }

    const budget = canUseDailyBudget("reply");
    if (!budget.allowed) {
      logger.info("Auto-reply skipped: daily budget exhausted");
      await this.logReply(config, tweet, author, "", "rate_limited", "Daily budget exhausted", 0, source);
      return;
    }

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
          const { config, tweet, author, source } = item;
          const delay = config.minDelaySeconds * 1000 +
            Math.random() * (config.maxDelaySeconds - config.minDelaySeconds) * 1000;

          await new Promise((resolve) => setTimeout(resolve, delay));

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

          const client = new XApiClient(this.db, COMPANY_ID, config.xAccountSlug ?? "primary");
          const result = await client.createTweet({ text: replyText, replyTo: tweet.id });
          const latencyMs = Date.now() - startTime;

          await this.logReply(config, tweet, author, replyText, "sent", null, latencyMs, source, result.data?.id);

          logger.info(
            { target: config.targetXUsername, tweetId: tweet.id, replyId: result.data?.id, latencyMs, source },
            "Auto-reply sent",
          );

          publishGlobalLiveEvent({
            type: "auto_reply.sent",
            payload: { target: config.targetXUsername, tweetId: tweet.id, replyId: result.data?.id, latencyMs },
          });
        } catch (err) {
          const latencyMs = Date.now() - startTime;
          await this.logReply(item.config, item.tweet, item.author, "", "failed", String(err), latencyMs, item.source);
          logger.error({ err, target: item.config.targetXUsername, tweetId: item.tweet.id }, "Auto-reply failed");
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async logReply(
    config: AutoReplyConfigRow, tweet: TweetData, author: AuthorData,
    replyText: string, status: string, error: string | null,
    latencyMs: number, source: string, replyTweetId?: string,
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

    let todaySent = 0, todayFailed = 0, todayRateLimited = 0, avgLatencyMs = 0;

    for (const row of rows) {
      if (row.status === "sent") { todaySent = row.count; avgLatencyMs = row.avgLatency ?? 0; }
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
    await _service.loadSettings();
    await _service.loadConfigs();
  } catch (err) {
    logger.warn({ err }, "Auto-reply init failed (table may not exist yet)");
  }
}

export function getAutoReplyService(): AutoReplyService | null {
  return _service;
}

// ---------------------------------------------------------------------------
// Auto-reply cron — registered with the central cron registry so it appears
// in the admin Cron Jobs UI alongside every other scheduled job.
//
// Schedule is fixed at `*/30 * * * *` (every 30 minutes). The poll interval
// in `autoReplySettings.pollIntervalMinutes` is still the authoritative
// default, but changing it via the settings API will only take effect on
// next server restart (or by editing `schedule_override` on the cron row).
// A future enhancement could add a `getSchedule?: () => string` hook to
// CronJobDefinition for live re-reads.
// ---------------------------------------------------------------------------

export function startAutoReplyCron(): () => void {
  registerCronJob({
    jobName: "auto-reply:poll",
    schedule: "*/30 * * * *",
    ownerAgent: "core",
    sourceFile: "auto-reply.ts",
    handler: async () => {
      const svc = getAutoReplyService();
      if (!svc) return { skipped: true, reason: "service not initialized" };

      try {
        const result = await svc.pollViaSearch();
        if (result.found > 0) {
          logger.info(result, "Auto-reply poll completed");
        }
        return result;
      } catch (err) {
        logger.error({ err }, "Auto-reply poll failed");
        throw err;
      }
    },
  });

  logger.info("Auto-reply cron registered (central registry, */30 min)");

  // No timer to stop — the central scheduler owns the tick loop.
  return () => {};
}
