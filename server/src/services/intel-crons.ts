import type { Db } from "@paperclipai/db";
import { intelService } from "./intel.js";
import { intelDiscoveryService } from "./intel-discovery.js";
import { mintscanService } from "./mintscan.js";
import { intelBillingService } from "./intel-billing.js";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngestResult {
  success: boolean;
  processed: number;
  skipped: number;
  errors: string[];
  offset: number;
  limit: number;
  total: number;
  next_offset: number;
}

// ---------------------------------------------------------------------------
// Pagination helper — loops through all pages so every company gets processed
// ---------------------------------------------------------------------------

async function paginatedIngest(
  ingestFn: (limit: number, offset: number) => Promise<IngestResult>,
  pageSize: number,
): Promise<{ totalProcessed: number; totalErrors: number; pages: number }> {
  let offset = 0;
  let totalProcessed = 0;
  let totalErrors = 0;
  let pages = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await ingestFn(pageSize, offset);
    totalProcessed += result.processed;
    totalErrors += result.errors.length;
    pages++;

    if (result.next_offset >= result.total) break;
    offset = result.next_offset;

    // Safety: cap at 50 pages to avoid infinite loops
    if (pages >= 50) break;
  }

  return { totalProcessed, totalErrors, pages };
}

// ---------------------------------------------------------------------------
// Register intel cron jobs (all owned by Echo — Data Engineer)
// ---------------------------------------------------------------------------

export function startIntelCrons(db: Db) {
  const svc = intelService(db);
  const discovery = intelDiscoveryService(db);
  const mintscan = mintscanService(db);
  const billing = intelBillingService(db);

  registerCronJob({ jobName: "intel:billing-overage", schedule: "17 2 * * *",  ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => billing.reportOverageUsage() });
  registerCronJob({ jobName: "intel:prices",        schedule: "0 * * * *",    ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => paginatedIngest((l, o) => svc.ingestPrices(l, o), 100) });
  registerCronJob({ jobName: "intel:news",           schedule: "0 * * * *",    ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => paginatedIngest((l, o) => svc.ingestNews(l, o), 50) });
  registerCronJob({ jobName: "intel:twitter",        schedule: "*/30 * * * *", ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => paginatedIngest((l, o) => svc.ingestTwitter(l, o), 30) });
  registerCronJob({ jobName: "intel:github",         schedule: "0 */4 * * *",  ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => paginatedIngest((l, o) => svc.ingestGithub(l, o), 25) });
  registerCronJob({ jobName: "intel:reddit",         schedule: "0 */2 * * *",  ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => paginatedIngest((l, o) => svc.ingestReddit(l, o), 30) });
  registerCronJob({ jobName: "intel:chain-metrics",  schedule: "0 */4 * * *",  ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => mintscan.ingestChainMetrics() });
  registerCronJob({ jobName: "intel:backfill",       schedule: "0 */12 * * *", ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => svc.backfillNewCompanies() });
  registerCronJob({ jobName: "intel:discover",       schedule: "0 */6 * * *",  ownerAgent: "echo", sourceFile: "intel-crons.ts", handler: () => discovery.discoverNewProjects() });

  logger.info({ count: 9 }, "Intel cron jobs registered");
}
