import type { Db } from "@paperclipai/db";
import { FilteredStreamClient, type StreamTweet } from "./filtered-stream-client.js";
import { syncRules, getTopicForTag } from "./stream-rule-manager.js";
import { ingestTweet } from "./social-pulse.js";
import { getAutoReplyService } from "./auto-reply.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamStatus {
  connected: boolean;
  uptime: number;
  tweetsPerMinute: number;
  lastHeartbeat: string | null;
  lastError: string | null;
  fallbackToPolling: boolean;
  bearerTokenPresent: boolean;
  reconnectAttempts: number;
  totalTweetsIngested: number;
  startedAt: string | null;
}

// ---------------------------------------------------------------------------
// Stream Connection Manager — singleton
// ---------------------------------------------------------------------------

const MAX_RECONNECT_ATTEMPTS = 5;
// If connected for 30+ min with zero tweets, consider unhealthy so polling kicks in
const STALENESS_THRESHOLD_MS = 30 * 60 * 1000;

class StreamConnectionManager {
  private client: FilteredStreamClient | null = null;
  private db: Db | null = null;
  private started = false;
  private tweetTimestamps: number[] = [];
  private reconnecting = false;
  private fallbackToPolling = false;
  private lastError: string | null = null;
  private totalTweetsIngested = 0;
  private startedAt: Date | null = null;
  private lastTweetAt: Date | null = null;

  getDb(): Db | null {
    return this.db;
  }

  async startStream(db: Db): Promise<void> {
    const token = process.env.BEARER_TOKEN;
    if (!token) {
      this.lastError = "BEARER_TOKEN not set";
      logger.warn("BEARER_TOKEN not set — filtered stream disabled");
      return;
    }

    if (this.started) {
      logger.warn("Stream connection manager already started");
      return;
    }

    this.db = db;
    this.started = true;
    this.startedAt = new Date();
    this.client = new FilteredStreamClient(token);

    // Wire up event handlers
    this.client.on("tweet", (streamTweet: StreamTweet) => {
      void this.handleTweet(streamTweet);
    });

    this.client.on("heartbeat", () => {
      // Just tracking — lastHeartbeat is maintained by the client
    });

    this.client.on("error", (err: unknown) => {
      this.lastError = String(err);
      logger.error({ err }, "Stream connection error");
    });

    this.client.on("disconnect", () => {
      logger.warn("Stream disconnected, attempting reconnect");
      void this.attemptReconnect();
    });

    // Sync rules and connect
    try {
      await syncRules(this.client);
      // connect() is blocking (reads stream), so fire and forget
      void this.client.connect();
      logger.info("Filtered stream manager started");
    } catch (err) {
      this.lastError = `Start failed: ${String(err)}`;
      logger.error({ err }, "Failed to start filtered stream, falling back to polling");
      this.fallbackToPolling = true;
    }
  }

  stopStream(): void {
    if (this.client) {
      this.client.disconnect();
      this.client.removeAllListeners();
      this.client = null;
    }
    this.started = false;
    this.fallbackToPolling = false;
    this.reconnecting = false;
    this.tweetTimestamps = [];
    logger.info("Filtered stream manager stopped");
  }

  getStatus(): StreamStatus {
    const now = Date.now();

    // Prune timestamps older than 60s for tweets-per-minute calculation
    this.tweetTimestamps = this.tweetTimestamps.filter((t) => now - t < 60_000);

    return {
      connected: this.client?.isConnected() ?? false,
      uptime: this.client?.getUptime() ?? 0,
      tweetsPerMinute: this.tweetTimestamps.length,
      lastHeartbeat: this.client?.getLastHeartbeat()?.toISOString() ?? null,
      lastError: this.lastError,
      fallbackToPolling: this.fallbackToPolling,
      bearerTokenPresent: !!process.env.BEARER_TOKEN,
      reconnectAttempts: this.client?.getReconnectAttempts() ?? 0,
      totalTweetsIngested: this.totalTweetsIngested,
      startedAt: this.startedAt?.toISOString() ?? null,
    };
  }

  isStreamHealthy(): boolean {
    if (!this.client) return false;
    if (this.fallbackToPolling) return false;
    if (!this.client.isConnected()) return false;

    // Staleness check: if connected for 30+ min with no tweets, consider unhealthy
    // so that polling kicks in as a safety net
    const uptime = this.client.getUptime();
    if (uptime > STALENESS_THRESHOLD_MS && !this.lastTweetAt) {
      logger.warn({ uptimeMs: uptime }, "Stream connected but zero tweets received — marking unhealthy");
      return false;
    }
    if (this.lastTweetAt && uptime > STALENESS_THRESHOLD_MS) {
      const sinceLastTweet = Date.now() - this.lastTweetAt.getTime();
      if (sinceLastTweet > STALENESS_THRESHOLD_MS) {
        logger.warn({ sinceLastTweetMs: sinceLastTweet }, "Stream stale — no tweets in 30min");
        return false;
      }
    }

    return true;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async handleTweet(streamTweet: StreamTweet): Promise<void> {
    if (!this.db) return;

    const tweet = streamTweet.data;
    const users = streamTweet.includes?.users ?? [];
    const matchingRules = streamTweet.matching_rules ?? [];

    // Find user data
    const author = users.find((u) => u.id === tweet.author_id) ?? null;
    const authorData = author
      ? { username: author.username, name: author.name }
      : { username: "unknown", name: null };

    // Ingest once per matching topic
    const processedTopics = new Set<string>();
    for (const rule of matchingRules) {
      const topic = getTopicForTag(rule.tag);
      if (!topic || processedTopics.has(topic)) continue;
      processedTopics.add(topic);

      try {
        await ingestTweet(this.db, {
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.author_id,
          createdAt: tweet.created_at,
          publicMetrics: tweet.public_metrics ?? null,
        }, topic, authorData);
      } catch (err) {
        logger.error({ err, tweetId: tweet.id, topic }, "Failed to ingest stream tweet");
      }
    }

    this.tweetTimestamps.push(Date.now());
    this.totalTweetsIngested++;
    this.lastTweetAt = new Date();

    // Auto-reply trigger — check if this tweet's author is a target
    const autoReply = getAutoReplyService();
    if (autoReply) {
      void autoReply.checkAndReply({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.author_id,
        createdAt: tweet.created_at,
        publicMetrics: tweet.public_metrics ?? null,
      }, authorData, "stream");
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting || !this.client) return;
    this.reconnecting = true;

    try {
      while (this.client.getReconnectAttempts() < MAX_RECONNECT_ATTEMPTS) {
        const delay = this.client.getReconnectDelay();
        logger.info(
          { attempt: this.client.getReconnectAttempts(), delayMs: delay },
          "Reconnecting filtered stream",
        );

        await new Promise((resolve) => setTimeout(resolve, delay));

        if (!this.started) return; // stopped while waiting

        try {
          await syncRules(this.client);
          void this.client.connect();
          this.reconnecting = false;
          this.lastError = null;
          return;
        } catch (err) {
          this.lastError = `Reconnect failed: ${String(err)}`;
          logger.error({ err }, "Stream reconnect attempt failed");
        }
      }

      // Exhausted reconnect attempts
      this.lastError = `Reconnect exhausted after ${MAX_RECONNECT_ATTEMPTS} attempts`;
      logger.error(
        { attempts: MAX_RECONNECT_ATTEMPTS },
        "Filtered stream reconnect exhausted, falling back to polling",
      );
      this.fallbackToPolling = true;
    } finally {
      this.reconnecting = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const streamConnectionManager = new StreamConnectionManager();
