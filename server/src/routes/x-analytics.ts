import { Router } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { getRateLimitStatus } from "../services/x-api/index.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Company ID from env
// ---------------------------------------------------------------------------

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function xAnalyticsRoutes(db: Db) {
  const router = Router();

  // ── Rate Limits ──────────────────────────────────────────────────────────
  router.get("/rate-limits", (_req, res) => {
    try {
      const status = getRateLimitStatus();
      res.json(status);
    } catch (err) {
      logger.error({ err }, "Failed to get rate limit status");
      res.status(500).json({ error: "Failed to get rate limit status" });
    }
  });

  // ── Engagement Analytics ─────────────────────────────────────────────────
  router.get("/engagement", async (req, res) => {
    try {
      const days = Math.min(90, Math.max(1, parseInt(req.query.days as string, 10) || 7));

      // Daily counts grouped by action type
      const dailyCounts = await db.execute(sql`
        SELECT
          date_trunc('day', executed_at)::date AS date,
          action,
          COUNT(*)::int AS count
        FROM x_engagement_log
        WHERE company_id = ${COMPANY_ID}
          AND executed_at >= NOW() - (${days} || ' days')::interval
        GROUP BY date_trunc('day', executed_at), action
        ORDER BY date ASC, action ASC
      `);

      // Total counts by action
      const totalCounts = await db.execute(sql`
        SELECT
          action,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE success = true)::int AS success_count
        FROM x_engagement_log
        WHERE company_id = ${COMPANY_ID}
          AND executed_at >= NOW() - (${days} || ' days')::interval
        GROUP BY action
        ORDER BY count DESC
      `);

      // Top 10 target usernames by engagement count
      const topTargets = await db.execute(sql`
        SELECT
          target_username AS username,
          COUNT(*)::int AS engagement_count,
          array_agg(DISTINCT action) AS actions
        FROM x_engagement_log
        WHERE company_id = ${COMPANY_ID}
          AND executed_at >= NOW() - (${days} || ' days')::interval
          AND target_username IS NOT NULL
        GROUP BY target_username
        ORDER BY engagement_count DESC
        LIMIT 10
      `);

      res.json({
        daily: dailyCounts as unknown as Record<string, unknown>[],
        totals: totalCounts as unknown as Record<string, unknown>[],
        topTargets: topTargets as unknown as Record<string, unknown>[],
        days,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get engagement analytics");
      res.status(500).json({ error: "Failed to get engagement analytics" });
    }
  });

  // ── Posting Analytics ────────────────────────────────────────────────────
  router.get("/posting", async (req, res) => {
    try {
      const days = Math.min(90, Math.max(1, parseInt(req.query.days as string, 10) || 7));

      // Daily post counts
      const dailyPosts = await db.execute(sql`
        SELECT
          date_trunc('day', posted_at)::date AS date,
          COUNT(*)::int AS count
        FROM x_tweet_analytics
        WHERE company_id = ${COMPANY_ID}
          AND posted_at >= NOW() - (${days} || ' days')::interval
        GROUP BY date_trunc('day', posted_at)
        ORDER BY date ASC
      `);

      // Recent 20 posts with metrics
      const recentPosts = await db.execute(sql`
        SELECT
          tweet_id,
          tweet_text,
          posted_at,
          like_count,
          retweet_count,
          reply_count,
          impression_count,
          quote_count,
          fetched_at
        FROM x_tweet_analytics
        WHERE company_id = ${COMPANY_ID}
          AND posted_at >= NOW() - (${days} || ' days')::interval
        ORDER BY posted_at DESC
        LIMIT 20
      `);

      // Success rate (posts with at least 1 impression)
      const statsResult = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE impression_count > 0)::int AS with_impressions,
          COALESCE(SUM(like_count), 0)::int AS total_likes,
          COALESCE(SUM(retweet_count), 0)::int AS total_retweets,
          COALESCE(SUM(reply_count), 0)::int AS total_replies,
          COALESCE(SUM(impression_count), 0)::int AS total_impressions
        FROM x_tweet_analytics
        WHERE company_id = ${COMPANY_ID}
          AND posted_at >= NOW() - (${days} || ' days')::interval
      `);

      const statsRows = statsResult as unknown as Record<string, number>[];
      const stats = statsRows[0] ?? { total: 0, with_impressions: 0, total_likes: 0, total_retweets: 0, total_replies: 0, total_impressions: 0 };

      res.json({
        daily: dailyPosts as unknown as Record<string, unknown>[],
        recentPosts: recentPosts as unknown as Record<string, unknown>[],
        stats,
        days,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get posting analytics");
      res.status(500).json({ error: "Failed to get posting analytics" });
    }
  });

  // ── Extension Bot Status ─────────────────────────────────────────────────
  router.get("/extension-status", async (_req, res) => {
    try {
      // Probe chrome-bot noVNC — try Docker service name first (container-to-container),
      // then localhost (when server runs outside Docker)
      const probeUrls = ["http://chrome-bot:6080/", "http://localhost:6080/"];
      let healthy = false;

      for (const url of probeUrls) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        try {
          const probe = await fetch(url, { signal: controller.signal });
          if (probe.ok) { healthy = true; break; }
        } catch {
          // try next
        } finally {
          clearTimeout(timeout);
        }
      }

      res.json({
        running: healthy,
        vncUrl: healthy ? `http://31.220.61.12:6080` : null,
        container: "chrome-bot",
      });
    } catch (err) {
      logger.error({ err }, "Failed to get extension bot status");
      res.status(500).json({ error: "Failed to get extension bot status" });
    }
  });

  // ── Connection Status ────────────────────────────────────────────────────
  router.get("/connection", async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT x_username, x_user_id, expires_at, created_at
        FROM x_oauth_tokens
        WHERE company_id = ${COMPANY_ID}
        LIMIT 1
      `);

      const rows = result as unknown as Record<string, unknown>[];
      const row = rows[0];
      if (row) {
        res.json({
          connected: true,
          username: row.x_username as string,
          userId: row.x_user_id as string,
          expiresAt: row.expires_at,
          connectedAt: row.created_at,
        });
      } else {
        res.json({ connected: false });
      }
    } catch (err) {
      logger.error({ err }, "Failed to get connection status");
      res.status(500).json({ error: "Failed to get connection status" });
    }
  });

  // ── Recent Posts Feed (for Discord polling) ──────────────────────────────
  router.get("/recent-posts", async (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      if (!since) {
        res.status(400).json({ error: "since parameter required (ISO timestamp)" });
        return;
      }
      const limit = Math.min(30, Math.max(1, parseInt(req.query.limit as string ?? "10", 10) || 10));

      const posts = await db.execute(sql`
        SELECT
          tweet_id,
          tweet_text,
          posted_at,
          like_count,
          retweet_count,
          reply_count,
          impression_count,
          quote_count
        FROM x_tweet_analytics
        WHERE company_id = ${COMPANY_ID}
          AND posted_at > ${since}::timestamptz
        ORDER BY posted_at DESC
        LIMIT ${limit}
      `);

      res.json({ posts: posts as unknown as Record<string, unknown>[] });
    } catch (err) {
      logger.error({ err }, "Failed to get recent posts feed");
      res.status(500).json({ error: "Failed to get recent posts" });
    }
  });

  return router;
}
