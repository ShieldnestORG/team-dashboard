/**
 * YouTube Pipeline — API routes
 *
 * Admin endpoints for managing the YouTube automation pipeline.
 */

import { Router } from "express";
import { createReadStream, existsSync } from "fs";
import { stat, readdir } from "fs/promises";
import { join, basename } from "path";
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

const VIDEO_DIR = join(process.env.YT_DATA_DIR || "/paperclip/youtube", "videos");
const ASSETS_DIR = join(process.env.YT_DATA_DIR || "/paperclip/youtube", "assets");

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
      const { topic, visualMode, targetUrl } = req.body as { topic?: string; visualMode?: string; targetUrl?: string };
      // For site-walker mode, use targetUrl as the topic (it's the URL to walk)
      const effectiveTopic = (visualMode === "site-walker" && targetUrl) ? targetUrl : topic;
      // Run async — don't block the request
      const result = await runProductionPipeline(db, effectiveTopic, visualMode);
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

  // Reschedule a queue item
  router.patch("/queue/:id/schedule", async (req, res) => {
    try {
      const { publishTime } = req.body as { publishTime: string };
      if (!publishTime) {
        return res.status(400).json({ error: "publishTime is required (ISO 8601)" });
      }
      const newTime = new Date(publishTime);
      if (isNaN(newTime.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
      await db
        .update(ytPublishQueue)
        .set({ publishTime: newTime, status: "scheduled" })
        .where(
          and(
            eq(ytPublishQueue.id, req.params.id as string),
            eq(ytPublishQueue.companyId, COMPANY_ID),
          ),
        );
      res.json({ success: true, publishTime: newTime.toISOString() });
    } catch (err) {
      res.status(500).json({ error: "Failed to reschedule" });
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

  // ── Video Files (list + download) ─────────────────────────────

  // List all assembled video files with metadata from DB
  router.get("/videos", async (_req, res) => {
    try {
      // Get all productions that have video assets
      const productions = await db
        .select()
        .from(ytProductions)
        .where(eq(ytProductions.companyId, COMPANY_ID))
        .orderBy(desc(ytProductions.createdAt))
        .limit(100);

      // Get publish queue entries for titles and YouTube URLs
      const queue = await db
        .select()
        .from(ytPublishQueue)
        .where(eq(ytPublishQueue.companyId, COMPANY_ID));

      const queueByProdId = new Map(queue.map((q) => [q.productionId, q]));

      // List actual files on disk
      let diskFiles: string[] = [];
      try {
        if (existsSync(VIDEO_DIR)) {
          diskFiles = (await readdir(VIDEO_DIR)).filter((f) => f.endsWith(".mp4"));
        }
      } catch { /* dir may not exist */ }

      const diskFileSet = new Set(diskFiles);

      // Build video list — match productions to disk files
      const videos: Array<{
        filename: string;
        productionId: string;
        title: string;
        status: string;
        visualMode: string;
        fileSizeBytes: number;
        createdAt: string;
        youtubeUrl: string | null;
        publishStatus: string | null;
      }> = [];

      for (const prod of productions) {
        const assets = prod.assets as Record<string, unknown> | null;
        const videoPath = assets?.videoPath as string | undefined;
        if (!videoPath) continue;

        const filename = basename(videoPath);
        const onDisk = diskFileSet.has(filename);
        if (!onDisk) continue;

        let fileSizeBytes = 0;
        try {
          const st = await stat(join(VIDEO_DIR, filename));
          fileSizeBytes = st.size;
        } catch { /* file may have been deleted */ }

        const queueEntry = queueByProdId.get(prod.id);

        videos.push({
          filename,
          productionId: prod.id,
          title: queueEntry?.title || `Video ${prod.id.slice(0, 8)}`,
          status: prod.status || "unknown",
          visualMode: prod.visualMode || "presentation",
          fileSizeBytes,
          createdAt: (prod.createdAt as Date)?.toISOString() || "",
          youtubeUrl: queueEntry?.youtubeUrl || null,
          publishStatus: queueEntry?.status || null,
        });
      }

      // Also include orphan files not in DB
      for (const file of diskFiles) {
        if (!videos.some((v) => v.filename === file)) {
          let fileSizeBytes = 0;
          try {
            const st = await stat(join(VIDEO_DIR, file));
            fileSizeBytes = st.size;
          } catch { continue; }

          videos.push({
            filename: file,
            productionId: "",
            title: file.replace(/\.mp4$/, ""),
            status: "unknown",
            visualMode: "unknown",
            fileSizeBytes,
            createdAt: "",
            youtubeUrl: null,
            publishStatus: null,
          });
        }
      }

      const totalSize = videos.reduce((s, v) => s + v.fileSizeBytes, 0);
      res.json({ videos, totalSize, count: videos.length });
    } catch (err) {
      logger.error({ err }, "Failed to list videos");
      res.status(500).json({ error: "Failed to list videos" });
    }
  });

  // Download a video file
  router.get("/videos/:filename/download", async (req, res) => {
    try {
      const filename = req.params.filename as string;

      // Security: no path traversal
      if (filename.includes("/") || filename.includes("..") || !filename.endsWith(".mp4")) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const filePath = join(VIDEO_DIR, filename);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: "Video not found" });
      }

      const fileStat = await stat(filePath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", fileStat.size);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "public, max-age=3600");

      createReadStream(filePath).pipe(res);
    } catch (err) {
      logger.error({ err }, "Video download failed");
      res.status(500).json({ error: "Download failed" });
    }
  });

  return router;
}
