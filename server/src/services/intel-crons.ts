import type { Db } from "@paperclipai/db";
import { intelService } from "./intel.js";
import { intelDiscoveryService } from "./intel-discovery.js";
import { mintscanService } from "./mintscan.js";
import { parseCron, nextCronTick } from "./cron.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntelCronJob {
  name: string;
  schedule: string;
  run: () => Promise<unknown>;
  nextRun: Date | null;
  running: boolean;
}

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
// Cron scheduler
// ---------------------------------------------------------------------------

export function startIntelCrons(db: Db) {
  const svc = intelService(db);
  const discovery = intelDiscoveryService(db);
  const mintscan = mintscanService(db);

  const jobs: IntelCronJob[] = [
    // Aggressive schedules for near-realtime intel
    { name: "intel:prices",        schedule: "0 * * * *",      run: () => paginatedIngest((l, o) => svc.ingestPrices(l, o), 100),   nextRun: null, running: false },
    { name: "intel:news",          schedule: "0 * * * *",      run: () => paginatedIngest((l, o) => svc.ingestNews(l, o), 50),      nextRun: null, running: false },
    { name: "intel:twitter",       schedule: "*/30 * * * *",   run: () => paginatedIngest((l, o) => svc.ingestTwitter(l, o), 30),   nextRun: null, running: false },
    { name: "intel:github",        schedule: "0 */4 * * *",    run: () => paginatedIngest((l, o) => svc.ingestGithub(l, o), 25),    nextRun: null, running: false },
    { name: "intel:reddit",        schedule: "0 */2 * * *",    run: () => paginatedIngest((l, o) => svc.ingestReddit(l, o), 30),    nextRun: null, running: false },
    // Chain metrics — Mintscan Cosmos ecosystem APR data
    { name: "intel:chain-metrics", schedule: "0 */4 * * *",    run: () => mintscan.ingestChainMetrics(),                             nextRun: null, running: false },
    // Backfill — catches companies with sparse data
    { name: "intel:backfill",      schedule: "0 */12 * * *",   run: () => svc.backfillNewCompanies(),                                nextRun: null, running: false },
    // Discovery — find new trending projects to add to the directory
    { name: "intel:discover",      schedule: "0 */6 * * *",    run: () => discovery.discoverNewProjects(),                            nextRun: null, running: false },
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
    "Intel cron scheduler started (aggressive schedules)",
  );

  // Tick every 30 seconds
  const TICK_INTERVAL_MS = 30_000;

  const interval = setInterval(async () => {
    const now = new Date();

    for (const job of jobs) {
      if (job.running) continue;
      if (!job.nextRun || now < job.nextRun) continue;

      job.running = true;
      logger.info({ job: job.name }, "Intel cron job starting");

      try {
        const result = await job.run();
        logger.info({ job: job.name, result }, "Intel cron job completed");
      } catch (err) {
        logger.error({ err, job: job.name }, "Intel cron job failed");
      } finally {
        job.running = false;
        const parsed = parseCron(job.schedule);
        if (parsed) {
          job.nextRun = nextCronTick(parsed, new Date());
        }
      }
    }
  }, TICK_INTERVAL_MS);

  // Return cleanup function
  return () => clearInterval(interval);
}
