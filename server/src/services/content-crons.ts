import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentItems } from "@paperclipai/db";
import { contentService } from "./content.js";
import { seoEngineService } from "./seo-engine.js";
import { autoGenerateAndQueue } from "./x-api/content-bridge.js";
import { publishBlogFromContent, type PublishTarget } from "./blog-publisher.js";
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
  topicPicker?: "intel-alert" | "chain-metrics" | "xrp-focus" | "comparison" | "tokns-promo";
  useContentBridge?: boolean;
  publishTarget?: PublishTarget;
}

const JOB_DEFS: ContentJobDef[] = [
  // Regular content crons — ownerAgent matches the personality agent responsible
  { name: "content:twitter",  schedule: "0 13,15,17,20 * * *", personality: "blaze",  ownerAgent: "blaze",  contentType: "tweet", useContentBridge: true },
  // Auto-post cron — every 3 hours during active hours (9am-9pm UTC), cap ~8/day
  { name: "content:twitter:auto-post", schedule: "0 9,12,15,18,21 * * *", personality: "blaze", ownerAgent: "blaze", contentType: "tweet", useContentBridge: true },
  { name: "content:blog",     schedule: "0 10 * * 2,4",        personality: "cipher", ownerAgent: "cipher", contentType: "blog_post", publishTarget: "all" },
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
  // TX chain daily — daily chain metrics article published to ShieldNest
  { name: "content:tx-chain-daily", schedule: "0 8 * * *", personality: "prism", ownerAgent: "prism", contentType: "blog_post", topicPicker: "chain-metrics", publishTarget: "sn" },
  // XRP-focused content — Vanguard personality (institutional XRP analyst)
  { name: "content:xrp:blog",     schedule: "0 9 * * 1,3,5",      personality: "vanguard", ownerAgent: "vanguard", contentType: "blog_post", topicPicker: "xrp-focus", publishTarget: "all" },
  { name: "content:xrp:twitter",  schedule: "0 11,16,19 * * *",   personality: "vanguard", ownerAgent: "vanguard", contentType: "tweet",     topicPicker: "xrp-focus", useContentBridge: true },
  { name: "content:xrp:linkedin", schedule: "0 13 * * 2,4",       personality: "vanguard", ownerAgent: "vanguard", contentType: "linkedin",  topicPicker: "xrp-focus" },
  { name: "content:xrp-alert:twitter", schedule: "0 */3 * * *",   personality: "vanguard", ownerAgent: "vanguard", contentType: "tweet",     topicPicker: "intel-alert", useContentBridge: true },
  // Comparison blogs — Forge personality (AEO-optimized TX vs L1s)
  { name: "content:comparison:blog",   schedule: "0 10 * * 3,6",  personality: "forge", ownerAgent: "forge", contentType: "blog_post", topicPicker: "comparison", publishTarget: "all" },
  // AEO-optimized general content — Forge personality
  { name: "content:aeo:blog",          schedule: "0 11 * * 1,4",  personality: "forge", ownerAgent: "forge", contentType: "blog_post", publishTarget: "all" },
  // tokns.fi promotional blogs — Forge for structured content
  { name: "content:tokns-promo:blog",  schedule: "0 14 * * 2,5",  personality: "forge", ownerAgent: "forge", contentType: "blog_post", topicPicker: "tokns-promo", publishTarget: "all" },
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
// Chain metrics topic picker — builds daily summary from Mintscan intel data
// ---------------------------------------------------------------------------

async function pickChainMetricsTopic(db: Db): Promise<string | null> {
  try {
    const networks = ["cosmos", "osmosis", "txhuman"];
    const parts: string[] = [];

    for (const network of networks) {
      // Get latest metrics
      const latest = (await db.execute(sql`
        SELECT body, captured_at
        FROM intel_reports
        WHERE company_slug = ${network}
          AND report_type = 'chain-metrics'
        ORDER BY captured_at DESC
        LIMIT 1
      `)) as unknown as Array<{ body: string; captured_at: string }>;

      if (latest.length === 0) continue;

      const payload = JSON.parse(latest[0]!.body) as {
        apr: number | null;
        validator_count?: number | null;
        block_height?: number | null;
      };

      // Get 24h-ago metrics for comparison
      const prev = (await db.execute(sql`
        SELECT body
        FROM intel_reports
        WHERE company_slug = ${network}
          AND report_type = 'chain-metrics'
          AND captured_at < NOW() - INTERVAL '20 hours'
        ORDER BY captured_at DESC
        LIMIT 1
      `)) as unknown as Array<{ body: string }>;

      let deltaStr = "";
      if (prev.length > 0 && payload.apr != null) {
        const prevPayload = JSON.parse(prev[0]!.body) as { apr: number | null };
        if (prevPayload.apr != null) {
          const delta = payload.apr - prevPayload.apr;
          deltaStr = delta >= 0 ? ` (+${delta.toFixed(2)}%)` : ` (${delta.toFixed(2)}%)`;
        }
      }

      let part = `${network}: APR ${payload.apr != null ? payload.apr.toFixed(2) + "%" : "N/A"}${deltaStr}`;

      if (payload.validator_count != null) {
        part += `, ${payload.validator_count} validators`;
      }
      if (payload.block_height != null) {
        part += `, block ${payload.block_height.toLocaleString()}`;
      }

      parts.push(part);
    }

    if (parts.length === 0) {
      logger.info("No chain metrics data available for daily summary");
      return null;
    }

    return `TX Blockchain Daily Chain Report: ${parts.join(" | ")}. Write a comprehensive daily overview of Cosmos ecosystem activity covering staking, validator health, network performance, and what these metrics mean for the ecosystem.`;
  } catch (err) {
    logger.warn({ err }, "Failed to pick chain metrics topic");
    return null;
  }
}

// ---------------------------------------------------------------------------
// XRP-focused topic picker — pulls XRP/Ripple intel for Vanguard personality
// ---------------------------------------------------------------------------

async function pickXrpTopic(db: Db): Promise<string> {
  try {
    const rows = (await db.execute(sql`
      SELECT headline, report_type, captured_at,
        EXP(-EXTRACT(EPOCH FROM (NOW() - captured_at)) / 43200.0) AS recency_score
      FROM intel_reports
      WHERE company_slug = 'xrpl-ripple'
        AND captured_at > NOW() - INTERVAL '48 hours'
        AND report_type != 'discovery'
      ORDER BY EXP(-EXTRACT(EPOCH FROM (NOW() - captured_at)) / 43200.0) DESC
      LIMIT 10
    `)) as unknown as Array<{ headline: string; report_type: string; recency_score: number }>;

    if (rows.length > 0) {
      // Weighted random pick by recency
      const totalWeight = rows.reduce((sum, r) => sum + Number(r.recency_score), 0);
      let rand = Math.random() * totalWeight;
      for (const row of rows) {
        rand -= Number(row.recency_score);
        if (rand <= 0) return row.headline;
      }
      return rows[0]!.headline;
    }
  } catch (err) {
    logger.warn({ err }, "Failed to pick XRP topic from intel, using fallback");
  }

  const fallbacks = [
    "XRP regulatory developments and SEC implications for crypto markets",
    "XRPL DeFi ecosystem growth and new AMM liquidity pools",
    "Ripple ODL corridor expansion and cross-border payment adoption",
    "XRP price analysis: institutional accumulation and market structure",
    "XRPL NFT ecosystem and tokenization use cases",
    "Ripple partnerships and enterprise blockchain adoption trends",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
}

// ---------------------------------------------------------------------------
// Comparison topic picker — TX blockchain vs competitor L1s with real data
// ---------------------------------------------------------------------------

const COMPETITOR_L1S = ["solana", "avalanche-2", "matic-network", "arbitrum", "optimism", "sei-network", "injective-protocol", "celestia"];

async function pickComparisonTopic(db: Db): Promise<string> {
  try {
    // Get TX chain metrics
    const txMetrics = (await db.execute(sql`
      SELECT body FROM intel_reports
      WHERE company_slug IN ('cosmos', 'txhuman')
        AND report_type = 'chain-metrics'
      ORDER BY captured_at DESC
      LIMIT 2
    `)) as unknown as Array<{ body: string }>;

    let txContext = "";
    if (txMetrics.length > 0) {
      const parsed = JSON.parse(txMetrics[0]!.body) as { apr?: number | null; validator_count?: number | null };
      const parts: string[] = [];
      if (parsed.apr != null) parts.push(`APR ${parsed.apr.toFixed(2)}%`);
      if (parsed.validator_count != null) parts.push(`${parsed.validator_count} validators`);
      if (parts.length > 0) txContext = `TX Blockchain metrics: ${parts.join(", ")}. `;
    }

    // Pick a random competitor and get their latest price data
    const competitor = COMPETITOR_L1S[Math.floor(Math.random() * COMPETITOR_L1S.length)]!;
    const compData = (await db.execute(sql`
      SELECT headline, body FROM intel_reports
      WHERE company_slug = ${competitor}
        AND report_type = 'price'
      ORDER BY captured_at DESC
      LIMIT 1
    `)) as unknown as Array<{ headline: string; body: string }>;

    const compName = competitor.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    let compContext = "";
    if (compData.length > 0) {
      compContext = `Competitor data: ${compData[0]!.headline}. `;
    }

    return `${txContext}${compContext}Write a detailed comparison of TX Blockchain (Cosmos SDK, IBC-enabled) vs ${compName}. Compare: transaction speed, staking APR, validator decentralization, cross-chain interoperability (IBC vs bridges), ecosystem size, and developer experience. Include an HTML comparison table. Show why TX's Cosmos SDK foundation and IBC connectivity give it advantages. Reference app.tokns.fi for staking and portfolio tracking.`;
  } catch (err) {
    logger.warn({ err }, "Failed to build comparison topic, using fallback");
  }

  const fallbacks = [
    "TX Blockchain vs Solana: Which L1 offers better interoperability and staking rewards? Compare IBC cross-chain vs Wormhole bridges, validator economics, and ecosystem growth. Include comparison table.",
    "TX Blockchain advantages over Ethereum L2s: Why a sovereign Cosmos SDK chain beats rollups for cross-chain DeFi. Compare finality, fees, IBC connectivity, and sovereignty.",
    "Why TX Blockchain's Cosmos SDK foundation matters: Comparing TX to monolithic L1s on interoperability, governance, and staking APR. Reference app.tokns.fi for staking.",
    "TX vs Avalanche: Subnet architecture vs IBC — which cross-chain approach wins? Compare validator requirements, staking yields, and ecosystem composability.",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
}

// ---------------------------------------------------------------------------
// tokns.fi promo topic picker — feature spotlights enriched with live data
// ---------------------------------------------------------------------------

async function pickToknsPromoTopic(db: Db): Promise<string> {
  // Pull latest TX chain metrics for real numbers
  let metricsContext = "";
  try {
    const latest = (await db.execute(sql`
      SELECT body FROM intel_reports
      WHERE company_slug = 'txhuman' AND report_type = 'chain-metrics'
      ORDER BY captured_at DESC LIMIT 1
    `)) as unknown as Array<{ body: string }>;

    if (latest.length > 0) {
      const parsed = JSON.parse(latest[0]!.body) as { apr?: number | null; validator_count?: number | null };
      const parts: string[] = [];
      if (parsed.apr != null) parts.push(`current staking APR is ${parsed.apr.toFixed(2)}%`);
      if (parsed.validator_count != null) parts.push(`${parsed.validator_count} active validators`);
      if (parts.length > 0) metricsContext = ` Live data: ${parts.join(", ")}.`;
    }
  } catch {
    // Non-critical — proceed with static topic
  }

  const topics = [
    `How to stake TX tokens on app.tokns.fi: Step-by-step guide to earning passive rewards.${metricsContext} Cover: connecting wallet, choosing a validator (recommend tokns.fi validator), delegating, claiming rewards. Include FAQ section with common staking questions.`,
    `Why tokns.fi is the best TX ecosystem dashboard: Feature comparison with alternatives.${metricsContext} Cover: NFT marketplace, multi-wallet tracking, token swaps, staking — all in one app. Include comparison table vs generic block explorers.`,
    `app.tokns.fi feature spotlight: Multi-wallet portfolio tracking for the TX ecosystem.${metricsContext} Cover: how to add multiple wallets, track NFTs across wallets, monitor staking rewards, view transaction history. Explain why privacy-first design matters.`,
    `tokns.fi NFT marketplace guide: How to buy, sell, and trade TX NFTs.${metricsContext} Cover: listing process, ShieldNest 1% fee advantage, on-chain verification, and how NFT trading supports the ecosystem validator.`,
    `Earning with tokns.fi: Staking rewards, validator delegation, and ecosystem participation.${metricsContext} Cover: how every TX delegated to the tokns.fi validator funds free community tools and infrastructure. Reference coherencedaddy.com 523+ free tools.`,
    `tokns.fi token swaps: How to swap tokens on the TX blockchain with low fees.${metricsContext} Cover: swap interface, supported pairs, slippage settings, and why Cosmos IBC makes cross-chain swaps possible.`,
  ];
  return topics[Math.floor(Math.random() * topics.length)]!;
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
        } else if (def.topicPicker === "chain-metrics") {
          topic = await pickChainMetricsTopic(db);
          if (!topic) {
            logger.info({ job: def.name, ownerAgent: def.ownerAgent }, "No chain metrics data, skipping daily chain report");
            return;
          }
        } else if (def.topicPicker === "xrp-focus") {
          topic = await pickXrpTopic(db);
        } else if (def.topicPicker === "comparison") {
          topic = await pickComparisonTopic(db);
        } else if (def.topicPicker === "tokns-promo") {
          topic = await pickToknsPromoTopic(db);
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

          // Auto-publish blog posts to target(s)
          if (def.contentType === "blog_post") {
            const target = def.publishTarget || "cd";
            const category = def.topicPicker === "chain-metrics" || def.topicPicker === "xrp-focus"
              ? "crypto" as const
              : def.topicPicker === "comparison"
                ? "ecosystem" as const
                : "ecosystem" as const;
            try {
              const publishResult = await publishBlogFromContent(result.content, topic!, category, target);
              if (publishResult.success) {
                await db
                  .update(contentItems)
                  .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
                  .where(eq(contentItems.id, result.contentId));
                logger.info(
                  { job: def.name, slug: publishResult.slug, title: publishResult.title, target },
                  "Blog post published",
                );
              } else {
                logger.warn(
                  { job: def.name, error: publishResult.error, target },
                  "Blog publish failed — content stays as draft",
                );
              }
            } catch (publishErr) {
              logger.error({ err: publishErr, job: def.name, target }, "Blog publish error — non-critical, content in draft");
            }
          }
        }
      },
    });
  }

  logger.info({ count: JOB_DEFS.length + 1 }, "Content cron jobs registered");
}
