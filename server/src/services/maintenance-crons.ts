import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { parseCron, nextCronTick } from "./cron.js";
import { logger } from "../middleware/logger.js";
import { getLatestSignals } from "./trend-crons.js";

interface MaintenanceCronJob {
  name: string;
  schedule: string;
  ownerAgent: string;
  run: () => Promise<unknown>;
  nextRun: Date | null;
  running: boolean;
}

export function startMaintenanceCrons(db: Db) {
  const jobs: MaintenanceCronJob[] = [
    {
      name: "maintenance:stale-content",
      schedule: "0 3 * * *", // Daily at 3am
      ownerAgent: "bridge",
      run: async () => {
        // Find content items stuck in "generating" for >1 hour or failed
        const stale = await db.execute(
          sql`SELECT id, platform, status, created_at FROM content_items
              WHERE (status = 'generating' AND created_at < NOW() - INTERVAL '1 hour')
                 OR (status = 'failed' AND created_at > NOW() - INTERVAL '24 hours')
              ORDER BY created_at DESC
              LIMIT 50`,
        ) as unknown as Array<{ id: string; platform: string; status: string; created_at: string }>;

        if (stale.length > 0) {
          logger.warn(
            { count: stale.length, items: stale.slice(0, 5).map((s) => ({ id: s.id, status: s.status, platform: s.platform })) },
            "Maintenance: found stale/failed content items",
          );

          // Reset stuck "generating" items back to "pending" so they can be retried
          await db.execute(
            sql`UPDATE content_items SET status = 'pending'
                WHERE status = 'generating' AND created_at < NOW() - INTERVAL '1 hour'`,
          );
        }

        return { staleCount: stale.length };
      },
      nextRun: null,
      running: false,
    },
    {
      name: "maintenance:health-check",
      schedule: "0 */4 * * *", // Every 4 hours
      ownerAgent: "bridge",
      run: async () => {
        const checks: Record<string, boolean> = {};

        // Check DB connectivity
        try {
          await db.execute(sql`SELECT 1`);
          checks.db = true;
        } catch {
          checks.db = false;
          logger.error("Maintenance health-check: DB unreachable");
        }

        // Check if trend scanner has recent data
        const signals = getLatestSignals();
        checks.trendScanner = signals !== null;
        if (!signals) {
          logger.warn("Maintenance health-check: no trend signals cached");
        }

        // Check content generation pipeline
        try {
          const recent = await db.execute(
            sql`SELECT COUNT(*) as cnt FROM content_items
                WHERE created_at > NOW() - INTERVAL '24 hours'`,
          ) as unknown as Array<{ cnt: number }>;
          checks.contentPipeline = (recent[0]?.cnt ?? 0) > 0;
          if (!checks.contentPipeline) {
            logger.warn("Maintenance health-check: no content generated in last 24h");
          }
        } catch {
          checks.contentPipeline = false;
        }

        logger.info({ checks }, "Maintenance health-check completed");
        return checks;
      },
      nextRun: null,
      running: false,
    },
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
    "Maintenance cron scheduler started",
  );

  const TICK_INTERVAL_MS = 30_000;

  const interval = setInterval(async () => {
    const now = new Date();

    for (const job of jobs) {
      if (job.running) continue;
      if (!job.nextRun || now < job.nextRun) continue;

      job.running = true;
      logger.info({ job: job.name, ownerAgent: job.ownerAgent }, "Maintenance cron job starting");

      try {
        const result = await job.run();
        logger.info({ job: job.name, ownerAgent: job.ownerAgent, result }, "Maintenance cron job completed");
      } catch (err) {
        logger.error({ err, job: job.name, ownerAgent: job.ownerAgent }, "Maintenance cron job failed");
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
