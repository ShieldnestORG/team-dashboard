/**
 * YouTube Pipeline — API routes
 *
 * Admin endpoints for managing the YouTube automation pipeline.
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { ytProductions, ytPublishQueue, ytAnalytics, ytContentStrategies, ytSeoData } from "@paperclipai/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { runProductionPipeline } from "../services/youtube/production.js";
import { processPublishQueue, forcePublish } from "../services/youtube/publish-queue.js";
import { collectAnalytics, generateOptimizationInsights } from "../services/youtube/analytics.js";
import { generateContentStrategy } from "../services/youtube/content-strategy.js";
import { getTTSProviderStatus } from "../services/youtube/tts.js";
import { getBackendSummary } from "../services/visual-backends/index.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

export function youtubeRoutes(db: Db): Router {
  const router = Router();

  // ── Pipeline ─────────────────────────────────────────────────

  // List productions
  router.get("/pipeline", async (_req, res) => {
    try {
      const productions = await db
        .select()
        .from(ytProductions)
        .where(eq(ytProductions.companyId, COMPANY_ID))
        .orderBy(desc(ytProductions.createdAt))
        .limit(50);
      res.json({ productions });
    } catch (err) {
      logger.error({ err }, "Failed to list productions");
      res.status(500).json({ error: "Failed to list productions" });
    }
  });

  // Manually trigger pipeline
  router.post("/pipeline/run", async (req, res) => {
    try {
      const { topic, visualMode } = req.body as { topic?: string; visualMode?: string };
      // Run async — don't block the request
      const result = await runProductionPipeline(db, topic, visualMode);
      res.json({
        productionId: result.productionId,
        status: result.status,
        title: result.seo.title,
        duration: result.script.duration,
      });
    } catch (err) {
      logger.error({ err }, "Pipeline run failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Pipeline failed" });
    }
  });

  // ── Publish Queue ────────────────────────────────────────────

  router.get("/queue", async (_req, res) => {
    try {
      const queue = await db
        .select()
        .from(ytPublishQueue)
        .where(eq(ytPublishQueue.companyId, COMPANY_ID))
        .orderBy(desc(ytPublishQueue.createdAt))
        .limit(50);
      res.json({ queue });
    } catch (err) {
      res.status(500).json({ error: "Failed to list queue" });
    }
  });

  router.post("/queue/:id/publish-now", async (req, res) => {
    try {
      await forcePublish(db, req.params.id as string);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Publish failed" });
    }
  });

  router.delete("/queue/:id", async (req, res) => {
    try {
      await db
        .delete(ytPublishQueue)
        .where(
          and(
            eq(ytPublishQueue.id, req.params.id as string),
            eq(ytPublishQueue.companyId, COMPANY_ID),
          ),
        );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete queue item" });
    }
  });

  // ── Analytics ────────────────────────────────────────────────

  router.get("/analytics", async (_req, res) => {
    try {
      const analytics = await db
        .select()
        .from(ytAnalytics)
        .where(eq(ytAnalytics.companyId, COMPANY_ID))
        .orderBy(desc(ytAnalytics.analyzedAt))
        .limit(50);
      res.json({ analytics });
    } catch (err) {
      res.status(500).json({ error: "Failed to list analytics" });
    }
  });

  router.post("/analytics/collect", async (_req, res) => {
    try {
      const count = await collectAnalytics(db);
      res.json({ updated: count });
    } catch (err) {
      res.status(500).json({ error: "Analytics collection failed" });
    }
  });

  router.get("/analytics/insights", async (_req, res) => {
    try {
      const insights = await generateOptimizationInsights(db);
      res.json({ insights });
    } catch (err) {
      res.status(500).json({ error: "Insight generation failed" });
    }
  });

  // ── Strategies ───────────────────────────────────────────────

  router.get("/strategies", async (_req, res) => {
    try {
      const strategies = await db
        .select()
        .from(ytContentStrategies)
        .where(eq(ytContentStrategies.companyId, COMPANY_ID))
        .orderBy(desc(ytContentStrategies.createdAt))
        .limit(50);
      res.json({ strategies });
    } catch (err) {
      res.status(500).json({ error: "Failed to list strategies" });
    }
  });

  router.post("/strategies/generate", async (req, res) => {
    try {
      const { topic } = req.body as { topic?: string };
      const strategy = await generateContentStrategy(db, topic);
      res.json({ strategy });
    } catch (err) {
      res.status(500).json({ error: "Strategy generation failed" });
    }
  });

  // ── Config ───────────────────────────────────────────────────

  router.get("/config", async (_req, res) => {
    res.json({
      enabled: process.env.YT_PIPELINE_ENABLED !== "false",
      visualMode: process.env.YT_VISUAL_MODE || "presentation",
      ttsProviders: getTTSProviderStatus(),
      visualBackends: getBackendSummary(),
      youtubeConfigured: !!(
        process.env.YOUTUBE_CLIENT_ID &&
        process.env.YOUTUBE_CLIENT_SECRET &&
        process.env.YOUTUBE_REFRESH_TOKEN
      ),
    });
  });

  // ── Stats ────────────────────────────────────────────────────

  router.get("/stats", async (_req, res) => {
    try {
      const [prodStats] = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'ready') AS ready,
          COUNT(*) FILTER (WHERE status = 'published') AS published,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed,
          COUNT(*) FILTER (WHERE status = 'processing') AS processing,
          COUNT(*) AS total
        FROM yt_productions
        WHERE company_id = ${COMPANY_ID}
      `) as unknown as Array<Record<string, number>>;

      const [queueStats] = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
          COUNT(*) FILTER (WHERE status = 'published') AS published,
          COUNT(*) AS total
        FROM yt_publish_queue
        WHERE company_id = ${COMPANY_ID}
      `) as unknown as Array<Record<string, number>>;

      res.json({ productions: prodStats, queue: queueStats });
    } catch (err) {
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  return router;
}
