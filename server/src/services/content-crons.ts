import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentService } from "./content.js";
import { seoEngineService } from "./seo-engine.js";
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
  topicPicker?: "intel-alert";
}

const JOB_DEFS: Omit<ContentCronJob, "nextRun" | "running">[] = [
  // Regular content crons
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
  // Intel-alert content — reactive, triggered by hot intel signals
  { name: "content:intel-alert:twitter",  schedule: "*/45 * * * *", personality: "blaze", contentType: "tweet",   topicPicker: "intel-alert" },
  { name: "content:intel-alert:bluesky",  schedule: "0 */2 * * *",  personality: "spark", contentType: "bluesky", topicPicker: "intel-alert" },
];

// ---------------------------------------------------------------------------
// Smart topic picker — weighted by recency + engagement, diverse across dirs
// ---------------------------------------------------------------------------

async function pickTopic(db: Db): Promise<string> {
  try {
    const rows = (await db.execute(sql`
      SELECT
        r.headline,
        r.report_type,
        c.directory,
        r.captured_at,
        -- Exponential decay: half-life of ~12 hours
        EXP(-EXTRACT(EPOCH FROM (NOW() - r.captured_at)) / 43200.0) AS recency_score
      FROM intel_reports r
      JOIN intel_companies c ON c.slug = r.company_slug
      WHERE r.captured_at > NOW() - INTERVAL '48 hours'
        AND r.report_type != 'discovery'
      ORDER BY EXP(-EXTRACT(EPOCH FROM (NOW() - r.captured_at)) / 43200.0) DESC
      LIMIT 30
    `)) as unknown as Array<{ headline: string; report_type: string; directory: string; recency_score: number }>;

    if (rows.length > 0) {
      // Ensure directory diversity — pick from different directories
      const byDirectory = new Map<string, typeof rows>();
      for (const row of rows) {
        const dirRows = byDirectory.get(row.directory) ?? [];
        dirRows.push(row);
        byDirectory.set(row.directory, dirRows);
      }

      // Take top candidate from each directory, then pick randomly
      const diverse: typeof rows = [];
      for (const dirRows of byDirectory.values()) {
        if (dirRows.length > 0) diverse.push(dirRows[0]!);
      }

      // If we have diverse options, weighted random pick
      if (diverse.length > 0) {
        const totalWeight = diverse.reduce((sum, r) => sum + Number(r.recency_score), 0);
        let rand = Math.random() * totalWeight;
        for (const row of diverse) {
          rand -= Number(row.recency_score);
          if (rand <= 0) return row.headline;
        }
        return diverse[0]!.headline;
      }
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
    "AI model breakthroughs",
    "developer tooling advances",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
}

// ---------------------------------------------------------------------------
// Intel alert topic picker — finds hot signals for reactive content
// ---------------------------------------------------------------------------

async function pickIntelAlert(db: Db): Promise<string | null> {
  try {
    // Look for hot signals: big price moves, new releases, high-engagement posts
    const rows = (await db.execute(sql`
      (
        SELECT headline, report_type, captured_at
        FROM intel_reports
        WHERE report_type = 'price'
          AND captured_at > NOW() - INTERVAL '2 hours'
          AND body LIKE '%price_change_24h_pct%'
        ORDER BY captured_at DESC
        LIMIT 5
      )
      UNION ALL
      (
        SELECT headline, report_type, captured_at
        FROM intel_reports
        WHERE report_type = 'github'
          AND headline LIKE '%released%'
          AND captured_at > NOW() - INTERVAL '4 hours'
        ORDER BY captured_at DESC
        LIMIT 3
      )
      UNION ALL
      (
        SELECT headline, report_type, captured_at
        FROM intel_reports
        WHERE report_type IN ('reddit', 'twitter', 'news')
          AND captured_at > NOW() - INTERVAL '2 hours'
        ORDER BY captured_at DESC
        LIMIT 5
      )
    `)) as unknown as Array<{ headline: string; report_type: string; captured_at: string }>;

    if (rows.length === 0) return null;

    // Parse price moves and prioritize big movers
    for (const row of rows) {
      if (row.report_type === "price" && row.headline.includes("%")) {
        // Extract percentage from headline
        const match = row.headline.match(/([-\d.]+)%/);
        if (match && Math.abs(parseFloat(match[1]!)) > 10) {
          return row.headline;
        }
      }
    }

    // Otherwise pick the most recent hot signal
    return rows[0]!.headline;
  } catch (err) {
    logger.warn({ err }, "Failed to pick intel alert topic");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function startContentCrons(db: Db) {
  const svc = contentService(db);
  const seoEngine = seoEngineService();

  // SEO engine job — daily at 7am, generates blog post from trend signals
  const seoJob = {
    name: "content:seo-engine",
    schedule: "3 7 * * *",
    nextRun: null as Date | null,
    running: false,
  };
  {
    const parsed = parseCron(seoJob.schedule);
    if (parsed) seoJob.nextRun = nextCronTick(parsed, new Date());
  }

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

    // SEO engine check
    if (!seoJob.running && seoJob.nextRun && now >= seoJob.nextRun) {
      seoJob.running = true;
      logger.info({ job: seoJob.name }, "SEO engine cron starting");
      try {
        const result = await seoEngine.run();
        logger.info({ job: seoJob.name, result }, "SEO engine cron completed");
      } catch (err) {
        logger.error({ err, job: seoJob.name }, "SEO engine cron failed");
      } finally {
        seoJob.running = false;
        const parsed = parseCron(seoJob.schedule);
        if (parsed) seoJob.nextRun = nextCronTick(parsed, new Date());
      }
    }

    for (const job of jobs) {
      if (job.running) continue;
      if (!job.nextRun || now < job.nextRun) continue;

      job.running = true;
      logger.info({ job: job.name }, "Content cron job starting");

      try {
        let topic: string | null;

        if (job.topicPicker === "intel-alert") {
          topic = await pickIntelAlert(db);
          if (!topic) {
            // No hot intel — skip this cycle
            logger.info({ job: job.name }, "No hot intel signals, skipping alert content");
            continue;
          }
        } else {
          topic = await pickTopic(db);
        }

        const result = await svc.generate({
          personalityId: job.personality,
          contentType: job.contentType,
          topic,
        });
        logger.info(
          { job: job.name, contentId: result.contentId, topic, isAlert: !!job.topicPicker },
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
