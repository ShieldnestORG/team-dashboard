// ---------------------------------------------------------------------------
// Partner Network fulfillment cron jobs
// Generates the guaranteed monthly content mentions per tier (Proof/Performance/Premium)
// and biweekly Sage strategy docs for Premium partners.
// ---------------------------------------------------------------------------

import { eq, inArray, sql, and, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { contentService } from "./content.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

// Monthly mention quotas per tier (matches partner-network-prd.md).
const TIER_QUOTA: Record<string, number> = {
  proof: 2,
  performance: 8,
  premium: 20,
};

// Content plan per tier: ordered list of { personality, contentType }.
// Slice to quota minus already-generated count.
const TIER_CONTENT_PLAN: Record<string, Array<{ personality: string; contentType: string; ownerAgent: string }>> = {
  proof: [
    { personality: "cipher", contentType: "blog_post", ownerAgent: "cipher" },
    { personality: "spark", contentType: "discord", ownerAgent: "spark" },
  ],
  performance: [
    { personality: "cipher", contentType: "blog_post", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "linkedin", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "blog_post", ownerAgent: "cipher" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "spark", contentType: "discord", ownerAgent: "spark" },
    { personality: "spark", contentType: "bluesky", ownerAgent: "spark" },
  ],
  premium: [
    { personality: "cipher", contentType: "blog_post", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "linkedin", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "blog_post", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "linkedin", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "blog_post", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "blog_post", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "linkedin", ownerAgent: "cipher" },
    { personality: "cipher", contentType: "blog_post", ownerAgent: "cipher" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "linkedin", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "blaze", contentType: "tweet", ownerAgent: "blaze" },
    { personality: "spark", contentType: "discord", ownerAgent: "spark" },
    { personality: "spark", contentType: "bluesky", ownerAgent: "spark" },
    { personality: "spark", contentType: "discord", ownerAgent: "spark" },
    { personality: "spark", contentType: "bluesky", ownerAgent: "spark" },
    // Slots 19–20 reserved for Sage strategy doc (separate cron).
  ],
};

async function getMentionsThisMonth(db: Db, partnerId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM content_items
    WHERE metadata->>'partner_id' = ${partnerId}
      AND created_at >= ${startOfMonth.toISOString()}
  `);
  const rows = result as unknown as Array<{ cnt: number }>;
  return rows[0]?.cnt ?? 0;
}

async function generatePartnerMentions(db: Db): Promise<void> {
  const activePartners = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        inArray(partnerCompanies.status, ["trial", "active"]),
      ),
    );

  for (const partner of activePartners) {
    const quota = TIER_QUOTA[partner.tier] ?? 0;
    if (quota === 0) continue;

    const generated = await getMentionsThisMonth(db, partner.id);
    const remaining = quota - generated;
    if (remaining <= 0) continue;

    const plan = TIER_CONTENT_PLAN[partner.tier] ?? [];
    const toGenerate = plan.slice(generated, generated + remaining);

    for (const item of toGenerate) {
      try {
        const svc = contentService(db);
        await svc.generate({
          personalityId: item.personality,
          contentType: item.contentType,
          topic: `${partner.name} — ${partner.industry} partner spotlight`,
          companyId: COMPANY_ID,
        });
      } catch (err) {
        logger.error(
          { err, partnerId: partner.id, personality: item.personality },
          "partner:mentions — generation failed",
        );
      }
    }

    logger.info(
      { partnerId: partner.id, tier: partner.tier, generated: toGenerate.length },
      "partner:mentions — batch complete",
    );
  }
}

// Sage strategy document for Premium partners — biweekly.
// Logs to content_items with contentType "strategy_doc".
async function generatePremiumStrategyDocs(db: Db): Promise<void> {
  const premiumPartners = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        eq(partnerCompanies.tier, "premium"),
        inArray(partnerCompanies.status, ["active"]),
      ),
    );

  for (const partner of premiumPartners) {
    try {
      const svc = contentService(db);
      await svc.generate({
        personalityId: "sage",
        contentType: "strategy_doc",
        topic: `AEO strategy review for ${partner.name} — ${partner.industry} — biweekly performance analysis and next-cycle content plan`,
        companyId: COMPANY_ID,
      });
      logger.info({ partnerId: partner.id }, "partner:strategy-doc — generated for premium partner");
    } catch (err) {
      logger.error({ err, partnerId: partner.id }, "partner:strategy-doc — failed");
    }
  }
}

export function startPartnerFulfillmentCrons(db: Db): void {
  // Monthly mention generation — 1st of month at 10 AM (staggered from directory at 9 AM).
  registerCronJob({
    jobName: "partner:mentions:generate",
    schedule: "0 10 1 * *",
    ownerAgent: "cipher",
    sourceFile: "partner-fulfillment-crons.ts",
    handler: () => generatePartnerMentions(db),
  });

  // Biweekly Sage strategy doc for Premium partners — 1st and 15th at 8 AM.
  registerCronJob({
    jobName: "partner:strategy-doc:premium",
    schedule: "0 8 1,15 * *",
    ownerAgent: "sage",
    sourceFile: "partner-fulfillment-crons.ts",
    handler: () => generatePremiumStrategyDocs(db),
  });
}
