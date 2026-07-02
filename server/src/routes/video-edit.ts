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
import { desc, eq, and, sql } from "drizzle-orm";
import { createReadStream, existsSync, statfsSync } from "fs";
import { stat } from "fs/promises";
import {
  processNextVideoEditJob,
  isEngineConfigured,
  isPipelineEnabled,
  getEnginePaths,
  assertInputDirSafe,
} from "../services/video-edit/index.js";
import { logger } from "../middleware/logger.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

function freeSpaceBytes(path: string): number | null {
  try {
    const s = statfsSync(path);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export function videoEditRoutes(db: Db): Router {
  const router = Router();

  // Admin-only: board-session operators only. Fail-closed — an anonymous
  // (actor.type='none') request is rejected with 401 before any handler runs.
  router.use(logAdminAccess(db));
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  // Rich status — what the UI / monitoring needs to see at a glance
  router.get("/config", async (_req, res) => {
    const paths = getEnginePaths();
    try {
      const [counts] = (await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
          COUNT(*) FILTER (WHERE status = 'running')  AS running,
          COUNT(*) FILTER (WHERE status = 'ready')    AS ready,
          COUNT(*) FILTER (WHERE status = 'failed')   AS failed,
          COUNT(*) FILTER (WHERE status = 'canceled') AS canceled
        FROM video_edit_jobs
        WHERE company_id = ${COMPANY_ID}
      `)) as unknown as Array<Record<string, number>>;

      const [running] = await db
        .select({ id: videoEditJobs.id, startedAt: videoEditJobs.startedAt })
        .from(videoEditJobs)
        .where(and(eq(videoEditJobs.companyId, COMPANY_ID), eq(videoEditJobs.status, "running")))
        .limit(1);

      const [lastReady] = await db
        .select({ completedAt: videoEditJobs.completedAt })
        .from(videoEditJobs)
        .where(and(eq(videoEditJobs.companyId, COMPANY_ID), eq(videoEditJobs.status, "ready")))
        .orderBy(desc(videoEditJobs.completedAt))
        .limit(1);

      const recentFailures = await db
        .select({ id: videoEditJobs.id, error: videoEditJobs.error, completedAt: videoEditJobs.completedAt })
        .from(videoEditJobs)
        .where(and(eq(videoEditJobs.companyId, COMPANY_ID), eq(videoEditJobs.status, "failed")))
        .orderBy(desc(videoEditJobs.completedAt))
        .limit(3);

      res.json({
        engine: "video-use",
        engineConfigured: isEngineConfigured(),
        pipelineEnabled: isPipelineEnabled(),
        videoUseBin: paths.VIDEO_USE_BIN || null,
        dataDir: paths.VIDEO_EDIT_DATA_DIR,
        freeDiskBytes: freeSpaceBytes(paths.VIDEO_EDIT_DATA_DIR),
        queue: {
          pending: Number(counts?.pending ?? 0),
          running: Number(counts?.running ?? 0),
          ready: Number(counts?.ready ?? 0),
          failed: Number(counts?.failed ?? 0),
          canceled: Number(counts?.canceled ?? 0),
        },
        runningJobId: running?.id ?? null,
        runningSince: running?.startedAt ?? null,
        lastCompletedAt: lastReady?.completedAt ?? null,
        recentFailures: recentFailures.map((f) => ({
          id: f.id,
          error: f.error?.slice(0, 200) ?? null,
          at: f.completedAt,
        })),
      });
    } catch (err) {
      logger.error({ err }, "Failed to build video-edit config");
      res.status(500).json({ error: "Failed to load config" });
    }
  });

  // Minimal count-by-status (matches /youtube/stats shape)
  router.get("/stats", async (_req, res) => {
    try {
      const [rows] = (await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
          COUNT(*) FILTER (WHERE status = 'running')  AS running,
          COUNT(*) FILTER (WHERE status = 'ready')    AS ready,
          COUNT(*) FILTER (WHERE status = 'failed')   AS failed,
          COUNT(*) FILTER (WHERE status = 'canceled') AS canceled,
          COUNT(*) AS total
        FROM video_edit_jobs
        WHERE company_id = ${COMPANY_ID}
      `)) as unknown as Array<Record<string, number>>;
      res.json({ jobs: rows });
    } catch (err) {
      logger.error({ err }, "Failed to load video-edit stats");
      res.status(500).json({ error: "Failed to load stats" });
    }
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

      // Confine inputDir to VIDEO_EDIT_DATA_DIR before the row is created —
      // surface bad paths as 400 instead of letting the queue cron pick it up
      // and fail. (Engine re-checks at run time via assertInputDirSafe.)
      try {
        assertInputDirSafe(inputDir.trim());
      } catch (err) {
        return res.status(400).json({
          error: err instanceof Error ? err.message : "inputDir failed safety check",
        });
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

  // Download the final.mp4 for a finished job.
  // Re-runs assertInputDirSafe-equivalent guard on the stored outputPath —
  // anyone who managed to insert a row pointing outside VIDEO_EDIT_DATA_DIR
  // still can't exfiltrate via this endpoint.
  router.get("/jobs/:id/video", async (req, res) => {
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
      if (!job.outputPath) return res.status(404).json({ error: "Job has no output yet" });
      if (job.filesPurgedAt) {
        return res.status(410).json({ error: "Output file has been purged by retention cron" });
      }
      if (!existsSync(job.outputPath)) {
        return res.status(404).json({ error: "Output file missing on disk" });
      }

      // Defense-in-depth — confirm the stored output path resolves under the data dir
      try {
        const { VIDEO_EDIT_DATA_DIR } = getEnginePaths();
        const { realpathSync } = await import("fs");
        const resolved = realpathSync(job.outputPath);
        const dataRoot = realpathSync(VIDEO_EDIT_DATA_DIR);
        if (resolved !== dataRoot && !resolved.startsWith(dataRoot + "/")) {
          logger.warn({ jobId: job.id, resolved, dataRoot }, "ve download: outputPath outside dataDir, refusing");
          return res.status(400).json({ error: "Output path outside data dir" });
        }
      } catch (err) {
        return res.status(500).json({ error: "Failed to validate output path" });
      }

      const fileStat = await stat(job.outputPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", fileStat.size);
      res.setHeader("Content-Disposition", `attachment; filename="video-edit-${job.id}.mp4"`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      createReadStream(job.outputPath).pipe(res);
    } catch (err) {
      logger.error({ err }, "video-edit download failed");
      res.status(500).json({ error: "Download failed" });
    }
  });

  return router;
}
