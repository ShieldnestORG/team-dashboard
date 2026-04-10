import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentItems } from "@paperclipai/db";
import { contentService } from "./content.js";
import { seoEngineService } from "./seo-engine.js";
import { autoGenerateAndQueue } from "./x-api/content-bridge.js";
import { publishBlogFromContent } from "./blog-publisher.js";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Content generation cron jobs
// Pattern: register with central cron-registry, no local setInterval.
// ---------------------------------------------------------------------------

interface ContentJobDef {
  name: string;
  schedule: string;
  personality: string;
  ownerAgent: string;
  contentType: string;
  topicPicker?: "intel-alert";
  useContentBridge?: boolean;
}

const JOB_DEFS: ContentJobDef[] = [
  // Regular content crons — ownerAgent matches the personality agent responsible
  { name: "content:twitter",  schedule: "0 13,15,17,20 * * *", personality: "blaze",  ownerAgent: "blaze",  contentType: "tweet", useContentBridge: true },
  // Auto-post cron — every 3 hours during active hours (9am-9pm UTC), cap ~8/day
  { name: "content:twitter:auto-post", schedule: "0 9,12,15,18,21 * * *", personality: "blaze", ownerAgent: "blaze", contentType: "tweet", useContentBridge: true },
  { name: "content:blog",     schedule: "0 10 * * 2,4",        personality: "cipher", ownerAgent: "cipher", contentType: "blog_post" },
  { name: "content:linkedin", schedule: "0 14 * * 1-5",        personality: "prism",  ownerAgent: "prism",  contentType: "linkedin" },
  { name: "content:discord",  schedule: "0 10,16,21 * * *",    personality: "spark",  ownerAgent: "spark",  contentType: "discord" },
  { name: "content:bluesky",  schedule: "0 14,17,20 * * *",    personality: "spark",  ownerAgent: "spark",  contentType: "bluesky" },
  { name: "content:reddit",   schedule: "0 15 * * *",          personality: "cipher", ownerAgent: "cipher", contentType: "reddit" },
  // Video script generation — text agents write scripts for visual content
  { name: "content:video:trend",  schedule: "0 11,14,18 * * *", personality: "blaze",  ownerAgent: "blaze",  contentType: "video_script" },
  { name: "content:video:market", schedule: "0 9 * * 1-5",      personality: "prism",  ownerAgent: "prism",  contentType: "video_script" },
  { name: "content:video:weekly", schedule: "0 10 * * 6",       personality: "prism",  ownerAgent: "prism",  contentType: "video_script" },
  // Intel-alert content — reactive, triggered by hot intel signals
  { name: "content:intel-alert:twitter",  schedule: "*/45 * * * *", personality: "blaze", ownerAgent: "blaze", contentType: "tweet",   topicPicker: "intel-alert", useContentBridge: true },
  { name: "content:intel-alert:bluesky",  schedule: "0 */2 * * *",  personality: "spark", ownerAgent: "spark", contentType: "bluesky", topicPicker: "intel-alert" },
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
// Register all content cron jobs
// ---------------------------------------------------------------------------

export function startContentCrons(db: Db) {
  const svc = contentService(db);
  const seoEngine = seoEngineService();

  // SEO engine job — daily at 7:03am
  registerCronJob({
    jobName: "content:seo-engine",
    schedule: "3 7 * * *",
    ownerAgent: "sage",
    sourceFile: "content-crons.ts",
    handler: async () => {
      const result = await seoEngine.run();
      logger.info({ result }, "SEO engine cron completed");
      return result;
    },
  });

  // Register all content generation jobs
  for (const def of JOB_DEFS) {
    registerCronJob({
      jobName: def.name,
      schedule: def.schedule,
      ownerAgent: def.ownerAgent,
      sourceFile: "content-crons.ts",
      handler: async () => {
        let topic: string | null;

        if (def.topicPicker === "intel-alert") {
          topic = await pickIntelAlert(db);
          if (!topic) {
            logger.info({ job: def.name, ownerAgent: def.ownerAgent }, "No hot intel signals, skipping alert content");
            return;
          }
        } else {
          topic = await pickTopic(db);
        }

        // Use enriched content bridge for twitter jobs
        if (def.useContentBridge && def.contentType === "tweet") {
          const companyId = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
          await autoGenerateAndQueue(db, def.personality, companyId, topic ?? undefined);
          logger.info(
            { job: def.name, ownerAgent: def.ownerAgent, topic, isAlert: !!def.topicPicker },
            "Content cron completed via content-bridge — tweet queued as draft",
          );
        } else {
          const result = await svc.generate({
            personalityId: def.personality,
            contentType: def.contentType,
            topic: topic!,
          });
          logger.info(
            { job: def.name, ownerAgent: def.ownerAgent, contentId: result.contentId, topic, isAlert: !!def.topicPicker },
            "Content cron completed — item queued as pending",
          );

          // Auto-publish blog posts to coherencedaddy.com
          if (def.contentType === "blog_post") {
            try {
              const publishResult = await publishBlogFromContent(result.content, topic!);
              if (publishResult.success) {
                await db
                  .update(contentItems)
                  .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
                  .where(eq(contentItems.id, result.contentId));
                logger.info(
                  { job: def.name, slug: publishResult.slug, title: publishResult.title },
                  "Blog post published to coherencedaddy.com",
                );
              } else {
                logger.warn(
                  { job: def.name, error: publishResult.error },
                  "Blog publish failed — content stays as draft",
                );
              }
            } catch (publishErr) {
              logger.error({ err: publishErr, job: def.name }, "Blog publish error — non-critical, content in draft");
            }
          }
        }
      },
    });
  }

  logger.info({ count: JOB_DEFS.length + 1 }, "Content cron jobs registered");
}
