import { trendScannerService } from "./trend-scanner.js";
import { parseCron, nextCronTick } from "./cron.js";
import { logger } from "../middleware/logger.js";

interface TrendCronJob {
  name: string;
  schedule: string;
  run: () => Promise<unknown>;
  nextRun: Date | null;
  running: boolean;
}

// In-memory cache of latest signals (served via API)
let latestSignals: unknown = null;

export function getLatestSignals() {
  return latestSignals;
}

export function startTrendCrons() {
  const svc = trendScannerService();

  const jobs: TrendCronJob[] = [
    {
      name: "trends:scan",
      schedule: "0 */6 * * *", // Every 6 hours
      run: async () => {
        const signals = await svc.scan();
        latestSignals = signals;
        return signals;
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

  // Run immediately on startup to populate cache
  void svc.scan().then((signals) => {
    latestSignals = signals;
    logger.info("Initial trend scan completed");
  }).catch((err) => {
    logger.error({ err }, "Initial trend scan failed");
  });

  logger.info(
    { jobs: jobs.map((j) => ({ name: j.name, schedule: j.schedule, nextRun: j.nextRun?.toISOString() })) },
    "Trend cron scheduler started",
  );

  const TICK_INTERVAL_MS = 30_000;

  const interval = setInterval(async () => {
    const now = new Date();

    for (const job of jobs) {
      if (job.running) continue;
      if (!job.nextRun || now < job.nextRun) continue;

      job.running = true;
      logger.info({ job: job.name }, "Trend cron job starting");

      try {
        const result = await job.run();
        logger.info({ job: job.name }, "Trend cron job completed");
      } catch (err) {
        logger.error({ err, job: job.name }, "Trend cron job failed");
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
