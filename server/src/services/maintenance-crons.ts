import { execSync } from "node:child_process";
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

  registerCronJob({
    jobName: "maintenance:failed-jobs-alert",
    schedule: "0 */6 * * *",
    ownerAgent: "bridge",
    sourceFile: "maintenance-crons.ts",
    handler: async () => {
      let failedCount = 0;
      let sample: Array<{ plugin_name: string; cnt: number }> = [];

      try {
        const rows = await db.execute(
          sql`SELECT COUNT(*) as cnt, plugin_name FROM plugin_job_runs
              WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'
              GROUP BY plugin_name
              LIMIT 10`,
        ) as unknown as Array<{ cnt: number; plugin_name: string }>;

        failedCount = rows.reduce((sum, r) => sum + Number(r.cnt), 0);
        sample = rows.map((r) => ({ plugin_name: r.plugin_name, cnt: Number(r.cnt) }));
      } catch {
        // Table may not exist yet — skip silently
        return { failedCount: 0 };
      }

      if (failedCount > 10) {
        logger.error(
          { failedCount, sample },
          "Maintenance: high failed plugin job count in last 24h",
        );
      } else if (failedCount > 0) {
        logger.warn(
          { failedCount, sample },
          "Maintenance: failed plugin jobs detected in last 24h",
        );
      }

      return { failedCount };
    },
  });

  registerCronJob({
    jobName: "maintenance:disk-space",
    schedule: "0 * * * *",
    ownerAgent: "bridge",
    sourceFile: "maintenance-crons.ts",
    handler: async () => {
      // df -k output: Filesystem  1K-blocks  Used  Available  Use%  Mounted on
      const dfLine = execSync("df -k / | tail -1").toString().trim();
      const parts = dfLine.split(/\s+/);
      const totalKb = parseInt(parts[1] ?? "0", 10);
      const usedKb = parseInt(parts[2] ?? "0", 10);
      const availKb = parseInt(parts[3] ?? "0", 10);

      const usedPercent = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;
      const freeGb = Math.round((availKb / 1024 / 1024) * 10) / 10;

      if (usedPercent >= 90) {
        logger.error({ usedPercent, freeGb }, "Maintenance: disk usage critical (>=90%)");
      } else if (usedPercent >= 80) {
        logger.warn({ usedPercent, freeGb }, "Maintenance: disk usage high (>=80%)");
      } else {
        logger.info({ usedPercent, freeGb }, "Maintenance: disk space OK");
      }

      return { usedPercent, freeGb };
    },
  });

  logger.info({ count: 4 }, "Maintenance cron jobs registered");
}
