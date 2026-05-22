/**
 * Video Edit Pipeline — Cron jobs
 *
 * Three crons keep the queue moving unattended:
 *   - ve:drain-queue (every 1m) → picks up a pending job, runs it
 *   - ve:reap-stuck  (every 15m) → resets `running` jobs older than the
 *     engine timeout (2hr) to `failed` so they don't wedge the single-runner queue
 *   - ve:cleanup-outputs (daily 02:00) → deletes final.mp4 files for jobs
 *     older than RETENTION_DAYS, marks files_purged_at so we don't revisit
 *
 * Gated by VIDEO_EDIT_ENABLED (default: enabled). Mirrors yt-crons.ts.
 */

import type { Db } from "@paperclipai/db";
import { videoEditJobs } from "@paperclipai/db";
import { and, eq, lt, isNull, sql } from "drizzle-orm";
import { unlink } from "fs/promises";
import { existsSync } from "fs";
import { registerCronJob } from "../cron-registry.js";
import { processNextVideoEditJob } from "./queue.js";
import { isPipelineEnabled } from "./engine.js";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";
const RETENTION_DAYS = 30;
const STUCK_THRESHOLD_HOURS = 2; // matches the engine's 2hr exec timeout

export interface VideoEditCronsHandle {
  enabled: boolean;
  jobNames: string[];
}

export function startVideoEditCrons(db: Db): VideoEditCronsHandle {
  if (!isPipelineEnabled()) {
    logger.warn(
      "Video Edit pipeline crons dormant (VIDEO_EDIT_ENABLED=false) — ve:drain-queue, ve:reap-stuck, ve:cleanup-outputs will NOT run",
    );
    return { enabled: false, jobNames: [] };
  }

  // Drain the queue — every minute pick up the oldest pending job (if any)
  registerCronJob({
    jobName: "ve:drain-queue",
    schedule: "* * * * *",
    ownerAgent: "core",
    sourceFile: "services/video-edit/ve-crons.ts",
    handler: async () => {
      const result = await processNextVideoEditJob(db);
      if (result.processed) {
        logger.info({ jobId: result.jobId }, "ve cron: drain processed a job");
      }
    },
  });

  // Reap stuck `running` jobs (engine crashed, container restarted mid-run, etc.)
  registerCronJob({
    jobName: "ve:reap-stuck",
    schedule: "*/15 * * * *",
    ownerAgent: "core",
    sourceFile: "services/video-edit/ve-crons.ts",
    handler: async () => {
      const reaped = await reapStuckJobs(db);
      if (reaped > 0) {
        logger.warn({ reaped, thresholdHours: STUCK_THRESHOLD_HOURS }, "ve cron: stuck jobs reaped");
      }
    },
  });

  // Daily output cleanup — 02:00 — delete final.mp4 for jobs older than retention
  registerCronJob({
    jobName: "ve:cleanup-outputs",
    schedule: "0 2 * * *",
    ownerAgent: "core",
    sourceFile: "services/video-edit/ve-crons.ts",
    handler: async () => {
      const purged = await cleanupOldOutputs(db);
      if (purged > 0) {
        logger.info({ purged, retentionDays: RETENTION_DAYS }, "ve cron: old outputs purged");
      }
    },
  });

  logger.info("Video Edit pipeline crons registered (3 jobs)");
  return { enabled: true, jobNames: ["ve:drain-queue", "ve:reap-stuck", "ve:cleanup-outputs"] };
}

/**
 * Reset `running` jobs whose `startedAt` exceeds the engine timeout to `failed`.
 * Prevents the single-runner queue from wedging on a dead run.
 */
export async function reapStuckJobs(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_HOURS * 60 * 60 * 1000);
  const stuck = await db
    .select({ id: videoEditJobs.id, startedAt: videoEditJobs.startedAt })
    .from(videoEditJobs)
    .where(
      and(
        eq(videoEditJobs.companyId, COMPANY_ID),
        eq(videoEditJobs.status, "running"),
        lt(videoEditJobs.startedAt, cutoff),
      ),
    );

  if (stuck.length === 0) return 0;

  await db
    .update(videoEditJobs)
    .set({
      status: "failed",
      error: `Reaped by ve:reap-stuck — startedAt exceeded ${STUCK_THRESHOLD_HOURS}hr threshold without completion`,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(videoEditJobs.companyId, COMPANY_ID),
        eq(videoEditJobs.status, "running"),
        lt(videoEditJobs.startedAt, cutoff),
      ),
    );

  return stuck.length;
}

/**
 * Delete final.mp4 files for `ready` jobs older than RETENTION_DAYS.
 * outputPath is kept on the row for audit; files_purged_at marks the cleanup.
 */
export async function cleanupOldOutputs(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const old = await db
    .select({ id: videoEditJobs.id, outputPath: videoEditJobs.outputPath })
    .from(videoEditJobs)
    .where(
      and(
        eq(videoEditJobs.companyId, COMPANY_ID),
        eq(videoEditJobs.status, "ready"),
        isNull(videoEditJobs.filesPurgedAt),
        lt(videoEditJobs.completedAt, cutoff),
      ),
    );

  if (old.length === 0) return 0;

  let purged = 0;
  for (const row of old) {
    if (row.outputPath && existsSync(row.outputPath)) {
      try {
        await unlink(row.outputPath);
      } catch (err) {
        logger.warn({ err, outputPath: row.outputPath, jobId: row.id }, "ve cleanup: unlink failed");
      }
    }
    await db
      .update(videoEditJobs)
      .set({ filesPurgedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(videoEditJobs.id, row.id));
    purged++;
  }

  return purged;
}
