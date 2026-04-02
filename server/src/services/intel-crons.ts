import type { Db } from "@paperclipai/db";
import { intelService } from "./intel.js";
import { parseCron, nextCronTick } from "./cron.js";
import { logger } from "../middleware/logger.js";

interface IntelCronJob {
  name: string;
  schedule: string;
  run: () => Promise<unknown>;
  nextRun: Date | null;
  running: boolean;
}

export function startIntelCrons(db: Db) {
  const svc = intelService(db);

  const jobs: IntelCronJob[] = [
    { name: "intel:prices", schedule: "0 */6 * * *", run: () => svc.ingestPrices(), nextRun: null, running: false },
    { name: "intel:news", schedule: "0 */4 * * *", run: () => svc.ingestNews(), nextRun: null, running: false },
    { name: "intel:twitter", schedule: "0 */2 * * *", run: () => svc.ingestTwitter(), nextRun: null, running: false },
    { name: "intel:github", schedule: "0 */8 * * *", run: () => svc.ingestGithub(), nextRun: null, running: false },
    { name: "intel:reddit", schedule: "0 */6 * * *", run: () => svc.ingestReddit(), nextRun: null, running: false },
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
    "Intel cron scheduler started",
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
