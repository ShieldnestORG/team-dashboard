import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { syncTopIntelCompanies } from "./firecrawl-sync.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Firecrawl cron scheduler — Echo's weekly intel site refresh.
// Runs Sundays at 3:47am local (off-peak, no clash with other Sunday crons).
// ---------------------------------------------------------------------------

export function startFirecrawlCrons(db: Db): void {
  registerCronJob({
    jobName: "firecrawl:sync",
    schedule: "47 3 * * 0",
    ownerAgent: "echo",
    sourceFile: "firecrawl-crons.ts",
    handler: async () => {
      return await syncTopIntelCompanies(db);
    },
  });

  logger.info({ count: 1 }, "Firecrawl cron jobs registered");
}
