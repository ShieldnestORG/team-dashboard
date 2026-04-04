import type { Db } from "@paperclipai/db";
import { contentService } from "./content.js";
import { parseCron, nextCronTick } from "./cron.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Content generation cron jobs
// Pattern: same as intel-crons.ts — tick-based, 30s interval, prevents
// concurrent runs. Each job picks a topic and calls contentService.generate()
// so content lands in the queue as "pending" (NOT auto-published).
// ---------------------------------------------------------------------------

interface ContentCronJob {
  name: string;
  schedule: string;
  personality: string;
  contentType: string;
  nextRun: Date | null;
  running: boolean;
}

const JOB_DEFS: Omit<ContentCronJob, "nextRun" | "running">[] = [
  { name: "content:twitter",  schedule: "0 13,15,17,20 * * *", personality: "blaze",  contentType: "tweet" },
  { name: "content:blog",     schedule: "0 10 * * 2,4",        personality: "cipher", contentType: "blog_post" },
  { name: "content:linkedin", schedule: "0 14 * * 1-5",        personality: "prism",  contentType: "linkedin" },
  { name: "content:discord",  schedule: "0 10,16,21 * * *",    personality: "spark",  contentType: "discord" },
  { name: "content:bluesky",  schedule: "0 14,17,20 * * *",    personality: "spark",  contentType: "bluesky" },
  { name: "content:reddit",   schedule: "0 15 * * *",          personality: "cipher", contentType: "reddit" },
  // Video script generation — text agents write scripts for visual content
  { name: "content:video:trend",  schedule: "0 11,14,18 * * *", personality: "blaze",  contentType: "video_script" },
  { name: "content:video:market", schedule: "0 9 * * 1-5",      personality: "prism",  contentType: "video_script" },
  { name: "content:video:weekly", schedule: "0 10 * * 6",       personality: "prism",  contentType: "video_script" },
];

// ---------------------------------------------------------------------------
// Topic picker — grab a recent intel report headline as the topic
// ---------------------------------------------------------------------------

async function pickTopic(db: Db): Promise<string> {
  try {
    const rows = (await db.execute(
      // Most recent intel reports with highest relevance
      /* sql */ `SELECT headline FROM intel_reports ORDER BY captured_at DESC LIMIT 10`,
    )) as unknown as Array<{ headline: string }>;

    if (rows.length > 0) {
      // Pick a random headline from the top 10 most recent
      const idx = Math.floor(Math.random() * rows.length);
      return rows[idx]!.headline;
    }
  } catch (err) {
    logger.warn({ err }, "Failed to pick topic from intel reports, using fallback");
  }

  // Fallback topics
  const fallbacks = [
    "blockchain ecosystem updates",
    "DeFi protocol innovations",
    "cryptocurrency market trends",
    "Web3 developer tools",
    "layer 2 scaling solutions",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function startContentCrons(db: Db) {
  const svc = contentService(db);

  const jobs: ContentCronJob[] = JOB_DEFS.map((def) => ({
    ...def,
    nextRun: null,
    running: false,
  }));

  // Compute initial next-run times
  for (const job of jobs) {
    const parsed = parseCron(job.schedule);
    if (parsed) {
      job.nextRun = nextCronTick(parsed, new Date());
    }
  }

  logger.info(
    { jobs: jobs.map((j) => ({ name: j.name, schedule: j.schedule, nextRun: j.nextRun?.toISOString() })) },
    "Content cron scheduler started",
  );

  // Tick every 30 seconds
  const TICK_INTERVAL_MS = 30_000;

  const interval = setInterval(async () => {
    const now = new Date();

    for (const job of jobs) {
      if (job.running) continue;
      if (!job.nextRun || now < job.nextRun) continue;

      job.running = true;
      logger.info({ job: job.name }, "Content cron job starting");

      try {
        const topic = await pickTopic(db);
        const result = await svc.generate({
          personalityId: job.personality,
          contentType: job.contentType,
          topic,
        });
        logger.info(
          { job: job.name, contentId: result.contentId, topic },
          "Content cron job completed — item queued as pending",
        );
      } catch (err) {
        logger.error({ err, job: job.name }, "Content cron job failed");
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
