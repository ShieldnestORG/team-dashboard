/**
 * YouTube Pipeline — Cron jobs
 *
 * Registers YouTube automation cron jobs with the centralized cron registry.
 */

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "../cron-registry.js";
import { runProductionPipeline } from "./production.js";
import { processPublishQueue } from "./publish-queue.js";
import { collectAnalytics, generateOptimizationInsights } from "./analytics.js";
import { logger } from "../../middleware/logger.js";

// Default: enabled. Set YT_PIPELINE_ENABLED=false to leave all 5 YouTube crons dormant
// (useful when the pipeline's heavy dependencies — Playwright, ffmpeg, Grok TTS — are
// not available on a given host). See CLAUDE.md env var reference.
const ENABLED = process.env.YT_PIPELINE_ENABLED !== "false";

export function startYouTubeCrons(db: Db): void {
  if (!ENABLED) {
    logger.warn(
      "YouTube pipeline crons dormant (YT_PIPELINE_ENABLED=false) — yt:daily-production, yt:publish-queue, yt:daily-analytics, yt:weekly-strategy, yt:optimization will NOT run",
    );
    return;
  }

  // Daily video production — 6 AM
  registerCronJob({
    jobName: "yt:daily-production",
    schedule: "0 6 * * *",
    ownerAgent: "core",
    sourceFile: "services/youtube/yt-crons.ts",
    handler: async () => {
      logger.info("YT cron: starting daily production pipeline");
      const result = await runProductionPipeline(db);
      logger.info({ productionId: result.productionId, status: result.status }, "YT daily production complete");
    },
  });

  // Process publish queue — every 15 minutes
  registerCronJob({
    jobName: "yt:publish-queue",
    schedule: "*/15 * * * *",
    ownerAgent: "core",
    sourceFile: "services/youtube/yt-crons.ts",
    handler: async () => {
      const count = await processPublishQueue(db);
      if (count > 0) logger.info({ published: count }, "YT publish queue processed");
    },
  });

  // Collect analytics — 9 AM daily
  registerCronJob({
    jobName: "yt:daily-analytics",
    schedule: "0 9 * * *",
    ownerAgent: "core",
    sourceFile: "services/youtube/yt-crons.ts",
    handler: async () => {
      const updated = await collectAnalytics(db);
      logger.info({ updated }, "YT analytics collected");
    },
  });

  // Weekly strategy review — Sunday 8 AM
  registerCronJob({
    jobName: "yt:weekly-strategy",
    schedule: "0 8 * * 0",
    ownerAgent: "core",
    sourceFile: "services/youtube/yt-crons.ts",
    handler: async () => {
      const insights = await generateOptimizationInsights(db);
      logger.info({ insightCount: insights.length }, "YT weekly strategy review complete");
    },
  });

  // Daily optimization — 10 PM
  registerCronJob({
    jobName: "yt:optimization",
    schedule: "0 22 * * *",
    ownerAgent: "core",
    sourceFile: "services/youtube/yt-crons.ts",
    handler: async () => {
      const insights = await generateOptimizationInsights(db);
      logger.info({ insightCount: insights.length }, "YT daily optimization complete");
    },
  });

  logger.info("YouTube pipeline crons registered (5 jobs)");
}
