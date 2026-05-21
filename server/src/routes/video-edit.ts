/**
 * Video Edit — API routes
 *
 * Admin endpoints for the Video Edit pipeline (browser-use/video-use).
 * Sibling to /youtube; this one edits real footage, doesn't synthesize.
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { videoEditJobs } from "@paperclipai/db";
import type { VideoEditOptions } from "@paperclipai/db";
import { desc, eq, and } from "drizzle-orm";
import {
  processNextVideoEditJob,
  isEngineConfigured,
  getEnginePaths,
} from "../services/video-edit/index.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

export function videoEditRoutes(db: Db): Router {
  const router = Router();

  router.get("/config", async (_req, res) => {
    const paths = getEnginePaths();
    res.json({
      engine: "video-use",
      engineConfigured: isEngineConfigured(),
      videoUseBin: paths.VIDEO_USE_BIN || null,
      dataDir: paths.VIDEO_EDIT_DATA_DIR,
    });
  });

  router.get("/jobs", async (_req, res) => {
    try {
      const jobs = await db
        .select()
        .from(videoEditJobs)
        .where(eq(videoEditJobs.companyId, COMPANY_ID))
        .orderBy(desc(videoEditJobs.createdAt))
        .limit(50);
      res.json({ jobs });
    } catch (err) {
      logger.error({ err }, "Failed to list video-edit jobs");
      res.status(500).json({ error: "Failed to list jobs" });
    }
  });

  router.get("/jobs/:id", async (req, res) => {
    try {
      const [job] = await db
        .select()
        .from(videoEditJobs)
        .where(
          and(
            eq(videoEditJobs.id, req.params.id as string),
            eq(videoEditJobs.companyId, COMPANY_ID),
          ),
        );
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json({ job });
    } catch (err) {
      logger.error({ err }, "Failed to load video-edit job");
      res.status(500).json({ error: "Failed to load job" });
    }
  });

  router.post("/jobs", async (req, res) => {
    try {
      const { inputDir, editBrief, options } = req.body as {
        inputDir?: string;
        editBrief?: string;
        options?: VideoEditOptions;
      };
      if (!inputDir || !inputDir.trim()) {
        return res.status(400).json({ error: "inputDir is required" });
      }
      if (!editBrief || !editBrief.trim()) {
        return res.status(400).json({ error: "editBrief is required" });
      }
      const [job] = await db
        .insert(videoEditJobs)
        .values({
          companyId: COMPANY_ID,
          inputDir: inputDir.trim(),
          editBrief: editBrief.trim(),
          options: options || null,
        })
        .returning();
      res.json({ job });
    } catch (err) {
      logger.error({ err }, "Failed to create video-edit job");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create job" });
    }
  });

  router.post("/jobs/:id/run", async (_req, res) => {
    try {
      // Kicks the queue; it picks the oldest pending job, which may or may
      // not be this one — that's by design (one job at a time).
      const result = await processNextVideoEditJob(db);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to run job" });
    }
  });

  router.post("/jobs/:id/cancel", async (req, res) => {
    try {
      const updated = await db
        .update(videoEditJobs)
        .set({ status: "canceled", updatedAt: new Date() })
        .where(
          and(
            eq(videoEditJobs.id, req.params.id as string),
            eq(videoEditJobs.companyId, COMPANY_ID),
            eq(videoEditJobs.status, "pending"),
          ),
        )
        .returning();
      if (updated.length === 0) {
        return res.status(409).json({ error: "Job is not in a cancelable state" });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to cancel job" });
    }
  });

  return router;
}
