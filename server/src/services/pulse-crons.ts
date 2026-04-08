import type { Db } from "@paperclipai/db";
import { socialPulseService } from "./social-pulse.js";
import { streamConnectionManager } from "./stream-connection-manager.js";
import { getAutoReplyService } from "./auto-reply.js";
import { parseCron, nextCronTick } from "./cron.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PulseCronJob {
  name: string;
  schedule: string;
  ownerAgent: string;
  run: () => Promise<unknown>;
  nextRun: Date | null;
  running: boolean;
}

// ---------------------------------------------------------------------------
// Cron scheduler — mirrors intel-crons.ts pattern
// ---------------------------------------------------------------------------

export function startPulseCrons(db: Db) {
  const svc = socialPulseService(db);

  const jobs: PulseCronJob[] = [
    { name: "pulse:search",         schedule: "*/5 * * * *",   ownerAgent: "echo", run: async () => {
      if (streamConnectionManager.isStreamHealthy()) {
        logger.info("Stream active, skipping pulse:search poll");
        return { skipped: true, reason: "stream_active" };
      }
      return svc.pollSearches();
    },              nextRun: null, running: false },
    { name: "pulse:sentiment",      schedule: "*/15 * * * *",  ownerAgent: "echo", run: () => svc.scoreSentiment(),            nextRun: null, running: false },
    { name: "pulse:aggregate-hour", schedule: "5 * * * *",     ownerAgent: "echo", run: () => svc.computeAggregations("hour"), nextRun: null, running: false },
    { name: "pulse:aggregate-day",  schedule: "10 0 * * *",    ownerAgent: "echo", run: () => svc.computeAggregations("day"),  nextRun: null, running: false },
    { name: "pulse:xrpl-bridge",    schedule: "*/10 * * * *",  ownerAgent: "echo", run: () => svc.tagXrplBridgeMentions(),     nextRun: null, running: false },
    { name: "pulse:spike-detect",   schedule: "*/15 * * * *",  ownerAgent: "echo", run: () => svc.detectVolumeSpikes(),        nextRun: null, running: false },
    { name: "pulse:backfill",      schedule: "0 */12 * * *",  ownerAgent: "echo", run: () => svc.backfillAggregations(),     nextRun: null, running: false },
    { name: "pulse:account-poll",  schedule: "*/2 * * * *",   ownerAgent: "echo", run: async () => {
      const autoReply = getAutoReplyService();
      if (!autoReply) return { skipped: true, reason: "auto_reply_not_initialized" };
      return autoReply.pollTargetAccounts();
    },              nextRun: null, running: false },
  ];

  // Compute initial next-run times
  for (const job of jobs) {
    const parsed = parseCron(job.schedule);
    if (parsed) {
      job.nextRun = nextCronTick(parsed, new Date());
    }
  }

  logger.info(
    { jobs: jobs.map((j) => ({ name: j.name, schedule: j.schedule, nextRun: j.nextRun?.toISOString() })) },
    "Pulse cron scheduler started",
  );

  // Tick every 30 seconds
  const TICK_INTERVAL_MS = 30_000;

  const interval = setInterval(async () => {
    const now = new Date();

    for (const job of jobs) {
      if (job.running) continue;
      if (!job.nextRun || now < job.nextRun) continue;

      job.running = true;
      logger.info({ job: job.name, ownerAgent: job.ownerAgent }, "Pulse cron job starting");

      try {
        const result = await job.run();
        logger.info({ job: job.name, ownerAgent: job.ownerAgent, result }, "Pulse cron job completed");
      } catch (err) {
        logger.error({ err, job: job.name, ownerAgent: job.ownerAgent }, "Pulse cron job failed");
      } finally {
        job.running = false;
        const parsed = parseCron(job.schedule);
        if (parsed) {
          job.nextRun = nextCronTick(parsed, new Date());
        }
      }
    }
  }, TICK_INTERVAL_MS);

  return () => clearInterval(interval);
}
