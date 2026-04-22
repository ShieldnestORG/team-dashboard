// ---------------------------------------------------------------------------
// Directory Listings cron jobs
// ---------------------------------------------------------------------------

import { sql, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { directoryListings, directoryListingEvents, intelCompanies } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { contentService } from "./content.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

// Monthly mention quotas per tier (matches directory-listings-prd.md).
const TIER_MENTION_QUOTA: Record<string, number> = {
  featured: 2,
  verified: 5,
  boosted: 15,
};

// Agents responsible for each tier's content.
const TIER_AGENTS: Record<string, Array<{ personality: string; contentType: string; ownerAgent: string }>> = {
  featured: [
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "blog_post", ownerAgent: "blaze" },
  ],
  verified: [
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "prism", contentType: "blog_post", ownerAgent: "prism" },
    { personality: "blaze", contentType: "linkedin", ownerAgent: "blaze" },
    { personality: "prism", contentType: "linkedin", ownerAgent: "prism" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
  ],
  boosted: [
    // 15 pieces: mix of Blaze (8) + Prism (5) + Sage review doc (1) + extra Prism (1)
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "blog_post", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "linkedin", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "bluesky", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "reddit", ownerAgent: "blaze" },
    { personality: "prism", contentType: "blog_post", ownerAgent: "prism" },
    { personality: "prism", contentType: "linkedin", ownerAgent: "prism" },
    { personality: "prism", contentType: "blog_post", ownerAgent: "prism" },
    { personality: "prism", contentType: "tweet", ownerAgent: "prism" },
    { personality: "prism", contentType: "bluesky", ownerAgent: "prism" },
    { personality: "prism", contentType: "linkedin", ownerAgent: "prism" },
    { personality: "prism", contentType: "blog_post", ownerAgent: "prism" },
  ],
};

async function countMentionsThisMonth(db: Db, listingId: number): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM directory_listing_events
    WHERE listing_id = ${listingId}
      AND event_type = 'content_mention'
      AND created_at >= ${startOfMonth.toISOString()}
  `);
  const rows = result as unknown as Array<{ cnt: number }>;
  return rows[0]?.cnt ?? 0;
}

async function generateDirectoryMentions(db: Db): Promise<void> {
  const activeListings = await db
    .select({
      listingId: directoryListings.id,
      tier: directoryListings.tier,
      companyId: directoryListings.companyId,
      companyName: intelCompanies.name,
    })
    .from(directoryListings)
    .leftJoin(intelCompanies, eq(directoryListings.companyId, intelCompanies.id))
    .where(inArray(directoryListings.status, ["active"]));

  for (const listing of activeListings) {
    const quota = TIER_MENTION_QUOTA[listing.tier] ?? 0;
    if (quota === 0 || !listing.companyName) continue;

    const generated = await countMentionsThisMonth(db, listing.listingId);
    const remaining = quota - generated;
    if (remaining <= 0) continue;

    const agents = TIER_AGENTS[listing.tier] ?? [];
    const toGenerate = agents.slice(0, remaining);

    for (const agent of toGenerate) {
      try {
        const svc = contentService(db);
        await svc.generate({
          personalityId: agent.personality,
          contentType: agent.contentType,
          topic: `${listing.companyName} — spotlight for directory listing`,
          companyId: COMPANY_ID,
        });
        await db.insert(directoryListingEvents).values({
          listingId: listing.listingId,
          eventType: "content_mention",
          payload: { agent: agent.ownerAgent, contentType: agent.contentType },
        });
      } catch (err) {
        logger.error({ err, listingId: listing.listingId, agent }, "directory:mentions — generation failed");
      }
    }

    logger.info(
      { listingId: listing.listingId, tier: listing.tier, generated: toGenerate.length },
      "directory:mentions — batch complete",
    );
  }
}

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

  // Monthly content mention generation for Featured/Verified/Boosted listings.
  // Runs on the 1st of each month at 9 AM — staggers across the month naturally
  // since the cron triggers once and generates the full batch for each listing.
  registerCronJob({
    jobName: "directory:mentions:generate",
    schedule: "0 9 1 * *",
    ownerAgent: "blaze",
    sourceFile: "directory-crons.ts",
    handler: () => generateDirectoryMentions(db),
  });
}
