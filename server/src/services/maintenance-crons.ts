import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";
import { getLatestSignals } from "./trend-crons.js";

export function startMaintenanceCrons(db: Db) {
  registerCronJob({
    jobName: "maintenance:stale-content",
    schedule: "0 3 * * *",
    ownerAgent: "bridge",
    sourceFile: "maintenance-crons.ts",
    handler: async () => {
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
  });

  registerCronJob({
    jobName: "maintenance:health-check",
    schedule: "0 */4 * * *",
    ownerAgent: "bridge",
    sourceFile: "maintenance-crons.ts",
    handler: async () => {
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
  });

  logger.info({ count: 2 }, "Maintenance cron jobs registered");
}
