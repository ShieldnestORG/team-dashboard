// ---------------------------------------------------------------------------
// Directory Listings cron jobs
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";

// Expire past_due listings that have been overdue for 30+ days.
async function expireListings(db: Db): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE directory_listings
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'past_due'
        AND updated_at < NOW() - INTERVAL '30 days'
    `);
    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "directory:expire-listings — expired past_due listings");
    }
  } catch (err) {
    logger.error({ err }, "directory:expire-listings — failed");
  }
}

export function startDirectoryCrons(db: Db): void {
  registerCronJob({
    jobName: "directory:expire-listings",
    schedule: "0 3 * * *", // 3 AM daily
    ownerAgent: "core",
    sourceFile: "directory-crons.ts",
    handler: () => expireListings(db),
  });
}
