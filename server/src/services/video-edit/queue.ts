/**
 * Video Edit Queue — processes pending video_edit_jobs one at a time.
 *
 * Editing is heavy (CPU, RAM, sometimes hours). We deliberately run one job
 * at a time and let pending jobs sit until the current one finishes.
 */

import type { Db } from "@paperclipai/db";
import { videoEditJobs } from "@paperclipai/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../../middleware/logger.js";
import { runVideoUseEngine } from "./engine.js";

export interface ProcessResult {
  processed: boolean;
  jobId?: string;
  reason?: string;
}

export async function processNextVideoEditJob(db: Db): Promise<ProcessResult> {
  const [running] = await db
    .select()
    .from(videoEditJobs)
    .where(eq(videoEditJobs.status, "running"))
    .limit(1);

  if (running) {
    return { processed: false, reason: "another job is already running" };
  }

  const [next] = await db
    .select()
    .from(videoEditJobs)
    .where(eq(videoEditJobs.status, "pending"))
    .orderBy(asc(videoEditJobs.createdAt))
    .limit(1);

  if (!next) {
    return { processed: false, reason: "no pending jobs" };
  }

  await db
    .update(videoEditJobs)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(videoEditJobs.id, next.id));

  try {
    const result = await runVideoUseEngine({
      inputDir: next.inputDir,
      editBrief: next.editBrief,
      options: next.options || undefined,
      jobId: next.id,
    });

    await db
      .update(videoEditJobs)
      .set({
        status: "ready",
        outputPath: result.outputPath,
        durationSec: result.durationSec,
        fileSizeBytes: result.fileSizeBytes,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videoEditJobs.id, next.id));

    return { processed: true, jobId: next.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId: next.id }, "video-edit job failed");

    await db
      .update(videoEditJobs)
      .set({
        status: "failed",
        error: msg.slice(0, 2000),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videoEditJobs.id, next.id));

    return { processed: true, jobId: next.id };
  }
}
