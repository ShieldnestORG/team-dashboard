// ---------------------------------------------------------------------------
// admin_access_log 90-day retention cron.
//
// admin_access_log is OPS TELEMETRY (route-middleware audit trail), not
// COMPLIANCE — see packages/db/src/schema/admin_access_log.ts for the split
// rationale. The table grows fast (one row per authenticated admin hit,
// plus 401s) and is only useful for short-window forensics, so retention
// is hard-capped at 90 days.
//
// This was flagged as TODO in migration 0114_admin_access_log.sql and in
// server/src/middleware/log-admin-access.ts.
//
// Cadence: daily at 04:30 UTC. 04:00 was already taken by the knowledge-graph
// cron, so we shift 30 min to spread load on the boot scheduler.
//
// Batch cap: 100k rows per run. The deletion predicate is bounded by the
// created_at index, but on a long backlog (e.g. retention disabled for a
// while) an unbounded DELETE could lock the table. 100k @ 90-day cutover
// is 3+ months of headroom over expected daily volume; if more than 100k
// rows accumulate behind the cutoff, subsequent days catch up.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";

const BATCH_CAP = 100_000;

export interface AdminAccessLogPurgeSummary {
  purged: number;
  durationMs: number;
}

export async function runAdminAccessLogPurge(
  db: Db,
): Promise<AdminAccessLogPurgeSummary> {
  const startedAt = Date.now();
  const result = (await db.execute(
    sql`DELETE FROM admin_access_log
        WHERE id IN (
          SELECT id FROM admin_access_log
          WHERE created_at < now() - INTERVAL '90 days'
          LIMIT ${BATCH_CAP}
        )`,
  )) as unknown as { rowCount?: number } | unknown[];
  const purged = Array.isArray(result)
    ? result.length
    : (result?.rowCount ?? 0);
  const durationMs = Date.now() - startedAt;

  if (purged > 0) {
    logger.info(
      { purged, durationMs, batchCap: BATCH_CAP },
      "admin_access_log retention purge completed",
    );
  } else {
    logger.debug(
      { purged, durationMs },
      "admin_access_log retention purge: nothing to delete",
    );
  }

  return { purged, durationMs };
}

export function startAdminAccessLogRetentionCron(db: Db): void {
  registerCronJob({
    jobName: "admin-access-log:purge",
    schedule: "30 4 * * *",
    ownerAgent: "system",
    sourceFile: "admin-access-log-retention-cron.ts",
    handler: () => runAdminAccessLogPurge(db),
  });
}
